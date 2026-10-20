import type { Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import { createGatewayContext, type GatewayContext } from "./context.js";

export function createTestContext(upstreamTimeoutMs = 2000): GatewayContext {
  return createGatewayContext({ dbPath: ":memory:", upstreamTimeoutMs });
}

export async function listen(
  app: ReturnType<typeof express>,
): Promise<{ server: HttpServer; url: string }> {
  const server = await new Promise<HttpServer>((resolve, reject) => {
    const s = app.listen(0, "127.0.0.1");
    s.once("listening", () => resolve(s));
    s.once("error", reject);
  });

  const { port } = server.address() as AddressInfo;

  return { server, url: `http://127.0.0.1:${port}` };
}

export async function close(server: HttpServer): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export interface FakeUpstreamOptions {
  name: string;
  tools: string[];
  bearerToken?: string;
  delayMs?: number;
  // Invoked for every executed tool call (used to prove writes run once).
  onCall?: (tool: string, args: unknown) => void;
}

// Minimal stateless MCP server. Each tool echoes its server name, tool name
// and arguments so tests can prove which upstream handled a call.
export async function startFakeUpstream(options: FakeUpstreamOptions) {
  const app = express();
  app.use(express.json());

  app.post("/mcp", async (req, res) => {
    if (
      options.bearerToken &&
      req.headers.authorization !== `Bearer ${options.bearerToken}`
    ) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    const server = new McpServer({ name: options.name, version: "1.0.0" });

    for (const tool of options.tools) {
      server.registerTool(
        tool,
        {
          description: `${tool} on ${options.name}`,
          inputSchema: { value: z.string().optional() },
        },
        async (args) => {
          options.onCall?.(tool, args);

          return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ server: options.name, tool, args }),
            },
          ],
          };
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const { server, url } = await listen(app);

  return { server, url: `${url}/mcp` };
}
