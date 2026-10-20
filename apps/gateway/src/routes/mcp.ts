import { Router } from "express";
import { z } from "zod";

import type { Database } from "../db/database.js";
import {
  getServerBySlug,
  listServers,
  toPublicServer,
} from "../db/servers.js";
import { AppError } from "../lib/app-error.js";
import { isToolAllowed, type GatewayTools } from "../mcp/gateway-tools.js";
import { namespaceTool } from "../mcp/tool-names.js";
import type { UpstreamManager } from "../mcp/upstream-manager.js";
import {
  getAuthenticatedUser,
  requireApiKey,
} from "../middleware/api-key-auth.js";

const toolCallSchema = z
  .object({
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).default({}),
  })
  .strict();

// REST view of the registry for the dashboard and scripts. Calls are routed
// through GatewayTools, so they are audited exactly like MCP calls.
export function createMcpRestRouter(
  db: Database,
  upstreams: UpstreamManager,
  tools: GatewayTools,
) {
  const router = Router();

  router.use("/api/mcp", requireApiKey(db, "rest"));

  function resolveServer(slug: string) {
    const server = getServerBySlug(db, slug);

    if (!server) {
      throw new AppError(404, "MCP_SERVER_NOT_FOUND", "MCP server not found");
    }

    return server;
  }

  // List servers with their status; credentials are never included.
  router.get("/api/mcp/servers", (_req, res) => {
    res.status(200).json({
      servers: listServers(db).map((server) => {
        const state = upstreams.getState(server);

        return {
          ...toPublicServer(server),
          status: state.status,
          statusError: state.error,
          checkedAt: state.checkedAt,
          toolCount: state.tools.length,
        };
      }),
    });
  });

  // Discover tools on one server (live).
  router.get("/api/mcp/servers/:serverId/tools", async (req, res) => {
    const server = resolveServer(String(req.params.serverId));

    if (!server.enabled) {
      throw new AppError(409, "MCP_SERVER_DISABLED", "MCP server is disabled");
    }

    try {
      const user = getAuthenticatedUser(res);
      const serverTools = (await upstreams.listTools(server)).filter((tool) =>
        isToolAllowed(user, server, tool.name),
      );

      res.status(200).json({
        serverId: server.slug,
        tools: serverTools.map((tool) => ({
          name: tool.name,
          exposedName: namespaceTool(server.slug, tool.name),
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    } catch (error) {
      throw new AppError(
        502,
        "MCP_SERVER_UNREACHABLE",
        upstreams.describeError(server, error),
      );
    }
  });

  // Execute a tool on one server.
  router.post("/api/mcp/servers/:serverId/tools/call", async (req, res) => {
    const server = resolveServer(String(req.params.serverId));
    const parsed = toolCallSchema.safeParse(req.body);

    if (!parsed.success) {
      throw new AppError(
        400,
        "INVALID_TOOL_REQUEST",
        "Invalid MCP tool invocation request",
      );
    }

    const { tool, arguments: args } = parsed.data;
    const user = getAuthenticatedUser(res);
    const result = await tools.callTool(
      user,
      namespaceTool(server.slug, tool),
      args,
      "rest",
    );

    res.status(200).json({ serverId: server.slug, tool, result });
  });

  return router;
}
