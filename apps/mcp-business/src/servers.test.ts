import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { ANALYTICS_SERVER, registerAnalyticsTools } from "./analytics/server.js";
import { createMcpHttpApp, type McpHttpOptions } from "./shared/http.js";
import { UTILITY_SERVER, registerUtilityTools } from "./utility/server.js";

const TOKEN = "t".repeat(40);
const running: Server[] = [];

after(() => {
  for (const server of running) {
    server.closeAllConnections();
    server.close();
  }
});

async function start(options: McpHttpOptions): Promise<string> {
  const server = createMcpHttpApp(options).listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  running.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

async function connect(url: string, token = TOKEN): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

function json(result: unknown) {
  const content = (result as CallToolResult).content[0];
  return JSON.parse(content.type === "text" ? content.text : "null");
}

test("utility server exposes its own identity and tools over Streamable HTTP", async () => {
  const url = await start({ ...UTILITY_SERVER, register: registerUtilityTools, authToken: TOKEN });
  const client = await connect(url);

  assert.equal(client.getServerVersion()?.name, "ajay-utility-mcp");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "calculate_discount", "calculate_order_total", "calculate_profit_margin", "convert_currency", "get_server_info",
  ]);

  const result = json(await client.callTool({ name: "convert_currency", arguments: { amount: 100, from: "USD", to: "EUR" } }));
  assert.equal(result.converted_amount, 92);

  const invalid = (await client.callTool({ name: "calculate_discount", arguments: { original_price: -1, discount_type: "fixed", discount_value: 1 } })) as CallToolResult;
  assert.equal(invalid.isError, true);
  await client.close();
});

test("analytics server exposes its own identity and analyses supplied orders", async () => {
  const url = await start({ ...ANALYTICS_SERVER, register: registerAnalyticsTools, authToken: TOKEN });
  const client = await connect(url);

  assert.equal(client.getServerVersion()?.name, "ajay-analytics-mcp");
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "get_order_status_breakdown", "get_sales_trend", "get_server_info", "get_top_products", "summarize_sales",
  ]);

  const orders = [{ id: 16, status: "processing", total: "479.00", currency: "INR", date_created: "2026-10-20T10:00:00", line_items: [] }];
  const summary = json(await client.callTool({ name: "summarize_sales", arguments: { orders } }));
  assert.equal(summary.gross_revenue, 479);
  await client.close();
});

test("servers reject requests without the configured bearer token", async () => {
  const url = await start({ ...UTILITY_SERVER, register: registerUtilityTools, authToken: TOKEN });

  await assert.rejects(connect(url, "wrong-token-wrong-token-wrong-token-xx"));
  const health = await fetch(url.replace("/mcp", "/health"));
  assert.equal(health.status, 200);
});
