import "dotenv/config";

import express from "express";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

import { timingSafeEqual } from "node:crypto";

const app = express();

app.use(express.json({ limit: "1mb" }));


const mcpAuthToken = process.env.MCP_AUTH_TOKEN;

if (!mcpAuthToken || mcpAuthToken.length < 32) {
  throw new Error(
    "MCP_AUTH_TOKEN must be configured with at least 32 characters",
  );
}

app.use("/mcp", (req, res, next) => {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const providedToken = authorization.slice("Bearer ".length);

  const expected = Buffer.from(mcpAuthToken);
  const actual = Buffer.from(providedToken);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  next();
});


const port = Number(process.env.PORT ?? 3001);

const sessions = new Map<
  string,
  {
    server: McpServer;
    transport: StreamableHTTPServerTransport;
  }
>();

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "ajay-woocommerce-mcp",
  });
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");

    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      if (sessionId) {
        res.status(404).json({
          error: "Unknown MCP session",
        });
        return;
      }

      const server = createMcpServer();

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        },
      });

      transport.onclose = () => {
        for (const [id, current] of sessions) {
          if (current.transport === transport) {
            sessions.delete(id);
          }
        }
      };

      await server.connect(transport);

      session = { server, transport };
    }

    await session.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP request failed:", error);

    if (!res.headersSent) {
      res.status(500).json({
        error: "Internal MCP server error",
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "GET transport not supported",
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).set("Allow", "POST").json({
    error: "DELETE transport not supported",
  });
});


const host = process.env.HOST ?? "127.0.0.1";

app.listen(port, host, () => {
  console.log(`AJAY MCP HTTP server listening on ${host}:${port}`);
});
