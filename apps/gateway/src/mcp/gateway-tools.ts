import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { writeAudit, type AuditSource } from "../db/audit.js";
import type { Database } from "../db/database.js";
import { getServerBySlug, type UpstreamServer } from "../db/servers.js";
import type { User } from "../db/users.js";
import {
  MAX_TOOL_NAME_LENGTH,
  namespaceTool,
  parseToolName,
} from "./tool-names.js";
import type { UpstreamManager } from "./upstream-manager.js";

// Role policy: members never see or call tools an admin marked admin-only
// (e.g. WooCommerce create_product). Enforced on both list and call, so a
// member cannot reach a hidden tool by guessing its name.
export function isToolAllowed(user: User, server: UpstreamServer, tool: string): boolean {
  return user.role === "admin" || !server.adminOnlyTools.includes(tool);
}

// Single entry point for listing and calling tools on behalf of a user.
// The MCP endpoint, REST API and chat agent all go through here, so policy
// and auditing cannot be bypassed by choosing a different front door.
export class GatewayTools {
  constructor(
    private readonly db: Database,
    private readonly upstreams: UpstreamManager,
  ) {}

  async listTools(user: User): Promise<Tool[]> {
    const upstreamTools = await this.upstreams.listAllTools();

    return upstreamTools.flatMap(({ server, tools }) =>
      tools
        .filter((tool) => isToolAllowed(user, server, tool.name))
        .map((tool) => ({
          ...tool,
          name: namespaceTool(server.slug, tool.name),
          description: `[${server.name}] ${tool.description ?? ""}`.trim(),
        }))
        .filter((tool) => tool.name.length <= MAX_TOOL_NAME_LENGTH),
    );
  }

  async callTool(
    user: User,
    exposedName: string,
    args: Record<string, unknown>,
    source: AuditSource,
  ): Promise<CallToolResult> {
    const startedAt = new Date();
    const parsed = parseToolName(exposedName);
    const server = parsed ? getServerBySlug(this.db, parsed.serverSlug) : undefined;

    const audit = (outcome: "success" | "error" | "denied", error?: string) =>
      writeAudit(this.db, {
        userId: user.id,
        userEmail: user.email,
        source,
        serverSlug: server?.slug ?? parsed?.serverSlug ?? null,
        tool: parsed?.tool ?? exposedName,
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        outcome,
        error,
      });

    if (!parsed || !server) {
      const message = `Unknown tool "${exposedName}"`;
      audit("denied", message);
      return errorResult(message);
    }

    if (!server.enabled) {
      const message = `Server "${server.slug}" is disabled`;
      audit("denied", message);
      return errorResult(message);
    }

    if (!isToolAllowed(user, server, parsed.tool)) {
      const message = `Tool "${exposedName}" requires the admin role`;
      audit("denied", message);
      return errorResult(message);
    }

    try {
      const result = await this.upstreams.callTool(server, parsed.tool, args);

      audit(
        result.isError ? "error" : "success",
        result.isError ? firstText(result) : undefined,
      );

      return result;
    } catch (error) {
      const message = this.upstreams.describeError(server, error);
      audit("error", message);
      return errorResult(message);
    }
  }
}

// Failures are returned as MCP tool errors so clients and the LLM see a clear
// message instead of a broken transport.
function errorResult(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function firstText(result: CallToolResult): string | undefined {
  const item = result.content.find((c) => c.type === "text");

  return item && item.type === "text" ? item.text : undefined;
}
