import { timingSafeEqual } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface McpHttpOptions {
  name: string;
  version: string;
  register: (server: McpServer) => void;
  // When set, every /mcp request must carry "Authorization: Bearer <token>".
  authToken?: string;
}

function tokenMatches(header: string | undefined, expected: string): boolean {
  const provided = Buffer.from(header?.replace(/^Bearer /i, "") ?? "");
  const wanted = Buffer.from(expected);

  return (
    header?.toLowerCase().startsWith("bearer ") === true &&
    provided.length === wanted.length &&
    timingSafeEqual(provided, wanted)
  );
}

// Stateless Streamable HTTP MCP server. These servers hold no state, so each
// request gets a fresh McpServer and nothing breaks when a pod restarts.
export function createMcpHttpApp(options: McpHttpOptions) {
  const app = express();

  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: options.name });
  });

  app.post("/mcp", async (req, res) => {
    if (options.authToken && !tokenMatches(req.headers.authorization, options.authToken)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const server = new McpServer({ name: options.name, version: options.version });
    options.register(server);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error(`${options.name} request failed:`, error);

      if (!res.headersSent) {
        res.status(500).json({ error: "Internal MCP server error" });
      }
    }
  });

  app.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({ error: "Method not allowed" });
  });

  return app;
}

export function startMcpHttpServer(
  options: Omit<McpHttpOptions, "authToken">,
): HttpServer {
  const authToken = process.env.MCP_AUTH_TOKEN;

  if (authToken !== undefined && authToken.length < 32) {
    throw new Error("MCP_AUTH_TOKEN must be at least 32 characters when set");
  }

  if (!authToken) {
    console.warn(`${options.name}: MCP_AUTH_TOKEN not set; /mcp is unauthenticated`);
  }

  const host = process.env.HOST ?? "127.0.0.1";
  const port = Number(process.env.PORT ?? 3002);
  const app = createMcpHttpApp({ ...options, authToken });

  const server = app.listen(port, host, () => {
    console.log(`${options.name} listening on ${host}:${port}`);
  });

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => server.close(() => process.exit(0)));
  }

  return server;
}
