import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

// End-to-end through the real MCP tools: a fake WooCommerce REST API stands in
// for the store, so this checks what an MCP client (the gateway) receives.
const requests: Array<{ url: string; headers: Record<string, string> }> = [];
const realFetch = globalThis.fetch;
let client: Client;

const STORE: Record<string, unknown> = {
  "data/currencies/current": { code: "INR", name: "Indian rupee", symbol: "&#8377;" },
  "products?per_page=2": [
    { id: 13, name: "AJAY Test T-Shirt", status: "publish", price: "479", regular_price: "479", price_html: "<b>x</b>" },
  ],
  "products/22": { id: 22, name: "AJAY Demo Mug", status: "draft", price: "12.99", regular_price: "12.99" },
};

before(async () => {
  process.env.WOOCOMMERCE_URL = "http://wordpress.test";
  process.env.WOOCOMMERCE_CONSUMER_KEY = "ck_test";
  process.env.WOOCOMMERCE_CONSUMER_SECRET = "cs_test";
  process.env.WOOCOMMERCE_FORWARDED_PROTO = "https";

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, headers: init?.headers as Record<string, string> });
    const path = url.replace("http://wordpress.test/wp-json/wc/v3/", "");
    const body = STORE[path];

    return new Response(JSON.stringify(body ?? { code: "not_found" }), {
      status: body ? 200 : 404,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  // Imported after the environment is set: the REST helper reads it on load.
  const { createMcpServer } = await import("../server.js");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer().connect(serverTransport);
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
});

after(async () => {
  await client.close();
  globalThis.fetch = realFetch;
});

function json(result: Awaited<ReturnType<Client["callTool"]>>): unknown {
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text);
}

test("list_products and get_product report the store currency, not an assumed one", async () => {
  const list = json(await client.callTool({ name: "list_products", arguments: { per_page: 2 } })) as Array<Record<string, unknown>>;
  assert.equal(list[0].currency, "INR");
  assert.equal(list[0].price, "479");
  assert.ok(!("price_html" in list[0]));

  const product = json(await client.callTool({ name: "get_product", arguments: { product_id: 22 } })) as Record<string, unknown>;
  assert.deepEqual([product.id, product.status, product.price, product.currency], [22, "draft", "12.99", "INR"]);
});

test("store requests send Basic auth and the configured forwarded scheme", () => {
  const request = requests.find((r) => r.url.endsWith("/products/22"));
  assert.ok(request);
  assert.equal(request.headers["X-Forwarded-Proto"], "https");
  assert.match(request.headers.Authorization, /^Basic /);
});
