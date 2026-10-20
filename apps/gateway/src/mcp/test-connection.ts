import { McpClient } from "./client.js";

const url = process.env.WOOCOMMERCE_MCP_URL ?? "http://localhost:3001/mcp";

const token = process.env.WOOCOMMERCE_MCP_TOKEN;

if (!token) {
  throw new Error("WOOCOMMERCE_MCP_TOKEN is required");
}

const client = new McpClient({
  id: "woocommerce",
  url,
  headers: { Authorization: `Bearer ${token}` },
});

try {
  await client.connect();

  console.log("Gateway connected to WooCommerce MCP server");

  const result = await client.listTools();

  console.log(
    "Discovered MCP tools:",
    result.tools.map((tool) => tool.name),
  );

  const products = await client.callTool("list_products", {
    per_page: 5,
  });

  console.log("WooCommerce MCP response:", JSON.stringify(products, null, 2));
} finally {
  await client.disconnect();
}
