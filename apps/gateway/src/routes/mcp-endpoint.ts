import { Router } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import type { Database } from "../db/database.js";
import type { User } from "../db/users.js";
import type { GatewayTools } from "../mcp/gateway-tools.js";
import {
  getAuthenticatedUser,
  requireApiKey,
} from "../middleware/api-key-auth.js";

// The low-level Server is used deliberately: a proxy forwards tool schemas it
// does not know at compile time, which the high-level McpServer cannot do.
function createGatewayMcpServer(tools: GatewayTools, user: User): Server {
  const server = new Server(
    { name: "ajay-mcp-gateway", version: "1.0.0" },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await tools.listTools(user),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) =>
    tools.callTool(
      user,
      request.params.name,
      request.params.arguments ?? {},
      "mcp",
    ),
  );

  return server;
}

// Stateless Streamable HTTP: every POST is authenticated and served by a fresh
// server bound to that user. No session state means a revoked key fails on
// the very next request and the gateway can run behind any load balancer.
export function createMcpEndpointRouter(db: Database, tools: GatewayTools) {
  const router = Router();

  router.post("/mcp", requireApiKey(db, "mcp"), async (req, res) => {
    const user = getAuthenticatedUser(res);
    const server = createGatewayMcpServer(tools, user);
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

  // Stateless mode has no server-initiated stream or session to delete.
  router.all("/mcp", (_req, res) => {
    res.status(405).set("Allow", "POST").json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed" },
      id: null,
    });
  });

  return router;
}
