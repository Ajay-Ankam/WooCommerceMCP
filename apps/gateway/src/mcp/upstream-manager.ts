import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import type { Database } from "../db/database.js";
import { listServers, type UpstreamServer } from "../db/servers.js";
import { McpClient } from "./client.js";

export type UpstreamStatus = "connected" | "unreachable" | "disabled" | "pending";

export interface UpstreamState {
  status: UpstreamStatus;
  error: string | null;
  checkedAt: string | null;
  tools: Tool[];
}

export interface UpstreamTools {
  server: UpstreamServer;
  tools: Tool[];
}

interface PooledClient {
  client: McpClient;
  // Changes when an admin edits URL or credential, forcing a reconnect.
  fingerprint: string;
}

function fingerprint(server: UpstreamServer): string {
  return [
    server.url,
    server.authType,
    server.authHeaderName,
    server.authSecret,
  ].join("\u0000");
}

function credentialHeaders(server: UpstreamServer): Record<string, string> {
  if (!server.authSecret) {
    return {};
  }

  if (server.authType === "bearer") {
    return { Authorization: `Bearer ${server.authSecret}` };
  }

  if (server.authType === "header" && server.authHeaderName) {
    return { [server.authHeaderName]: server.authSecret };
  }

  return {};
}

// A stale upstream session (e.g. the pod restarted) is safe to retry: the
// upstream rejected the request before executing anything.
function isStaleSession(error: unknown): boolean {
  return error instanceof StreamableHTTPError && error.code === 404;
}

export class UpstreamManager {
  private readonly clients = new Map<string, PooledClient>();
  private readonly states = new Map<string, UpstreamState>();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Database,
    private readonly timeoutMs: number,
  ) {}

  describeError(server: UpstreamServer, error: unknown): string {
    if (error instanceof McpError && error.code === ErrorCode.RequestTimeout) {
      return `Upstream "${server.slug}" timed out after ${this.timeoutMs}ms`;
    }

    const cause =
      error instanceof Error && error.cause instanceof Error
        ? error.cause.message
        : error instanceof Error
          ? error.message
          : String(error);

    return `Upstream "${server.slug}" failed: ${cause}`;
  }

  getState(server: UpstreamServer): UpstreamState {
    if (!server.enabled) {
      return { status: "disabled", error: null, checkedAt: null, tools: [] };
    }

    return (
      this.states.get(server.slug) ?? {
        status: "pending",
        error: null,
        checkedAt: null,
        tools: [],
      }
    );
  }

  private async getClient(server: UpstreamServer): Promise<McpClient> {
    const expected = fingerprint(server);
    const pooled = this.clients.get(server.slug);

    if (pooled && pooled.fingerprint === expected) {
      return pooled.client;
    }

    if (pooled) {
      await this.invalidate(server.slug);
    }

    const client = new McpClient({
      id: server.slug,
      url: server.url,
      headers: credentialHeaders(server),
      timeoutMs: this.timeoutMs,
    });

    this.clients.set(server.slug, { client, fingerprint: expected });

    return client;
  }

  private async invalidate(slug: string): Promise<void> {
    const pooled = this.clients.get(slug);

    this.clients.delete(slug);

    await pooled?.client.disconnect().catch(() => {});
  }

  private markUnreachable(server: UpstreamServer, error: unknown): void {
    this.states.set(server.slug, {
      status: "unreachable",
      error: this.describeError(server, error),
      checkedAt: new Date().toISOString(),
      tools: [],
    });
  }

  private async withClient<T>(
    server: UpstreamServer,
    operation: (client: McpClient) => Promise<T>,
    retryOnAnyError: boolean,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.getClient(server);
      const wasConnected = client.connected;

      try {
        await client.connect();
        return await operation(client);
      } catch (error) {
        await this.invalidate(server.slug);

        const canRetry =
          attempt === 0 &&
          wasConnected &&
          (retryOnAnyError || isStaleSession(error));

        if (!canRetry) {
          throw error;
        }
      }
    }
  }

  async listTools(server: UpstreamServer): Promise<Tool[]> {
    try {
      // Listing is idempotent, so any failure on a pooled connection retries.
      const result = await this.withClient(
        server,
        (client) => client.listTools(),
        true,
      );

      this.states.set(server.slug, {
        status: "connected",
        error: null,
        checkedAt: new Date().toISOString(),
        tools: result.tools,
      });

      return result.tools;
    } catch (error) {
      this.markUnreachable(server, error);
      throw error;
    }
  }

  // One slow or dead upstream never fails the whole listing.
  async listAllTools(): Promise<UpstreamTools[]> {
    const servers = listServers(this.db).filter((server) => server.enabled);

    const results = await Promise.allSettled(
      servers.map(async (server) => ({
        server,
        tools: await this.listTools(server),
      })),
    );

    return results.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
  }

  async callTool(
    server: UpstreamServer,
    tool: string,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    try {
      // Calls may not be idempotent: only retry when the upstream provably
      // rejected the stale session before executing the tool.
      const result = await this.withClient(
        server,
        (client) => client.callTool(tool, args),
        false,
      );

      return result as CallToolResult;
    } catch (error) {
      this.markUnreachable(server, error);
      throw error;
    }
  }

  startStatusRefresh(intervalMs: number): void {
    this.stopStatusRefresh();

    const refresh = () => {
      void this.listAllTools().catch(() => {});
    };

    refresh();
    this.refreshTimer = setInterval(refresh, intervalMs);
    this.refreshTimer.unref();
  }

  stopStatusRefresh(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  async close(): Promise<void> {
    this.stopStatusRefresh();

    await Promise.all(
      [...this.clients.keys()].map((slug) => this.invalidate(slug)),
    );
  }
}
