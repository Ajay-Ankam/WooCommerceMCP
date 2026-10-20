import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpServerConfig {
  id: string;
  url: string;
  // Static upstream credential headers; they never leave the gateway.
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;

export class McpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;

  constructor(private readonly config: McpServerConfig) {}

  get connected(): boolean {
    return this.client !== null;
  }

  private get requestOptions() {
    return { timeout: this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  }

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const client = new Client({
      name: "ajay-mcp-gateway",
      version: "1.0.0",
    });

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.url),
      {
        requestInit: {
          headers: this.config.headers ?? {},
        },
      },
    );

    try {
      await client.connect(transport, this.requestOptions);

      this.client = client;
      this.transport = transport;
    } catch (error) {
      await transport.close().catch(() => {});
      throw error;
    }
  }

  async listTools() {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    return this.client.listTools(undefined, this.requestOptions);
  }

  async callTool(name: string, args: Record<string, unknown> = {}) {
    if (!this.client) {
      throw new Error("MCP client is not connected");
    }

    return this.client.callTool(
      {
        name,
        arguments: args,
      },
      undefined,
      this.requestOptions,
    );
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;

    this.client = null;
    this.transport = null;

    if (transport) {
      await transport.close();
    }
  }
}
