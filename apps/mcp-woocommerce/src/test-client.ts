import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    env: {
      ...process.env,
    } as Record<string, string>,
  });

  const client = new Client({
    name: "ajay-mcp-test-client",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    console.log("Connected to WooCommerce MCP server.");

    const tools = await client.listTools();

    console.log(
      "Available MCP tools:",
      tools.tools.map((tool) => tool.name),
    );

    const result = await client.callTool({
      name: "list_products",
      arguments: {
        per_page: 5,
      },
    });

    if (result.isError) {
      console.error("MCP tool returned an error:", result.content);
      process.exitCode = 1;
      return;
    }

    console.log("list_products result:");

    // Validate the MCP response before accessing its contents
    if (!Array.isArray(result.content)) {
      throw new Error("Invalid MCP response: content is not an array");
    }

    for (const item of result.content) {
      if (
        typeof item === "object" &&
        item !== null &&
        "type" in item &&
        item.type === "text" &&
        "text" in item &&
        typeof item.text === "string"
      ) {
        const products = JSON.parse(item.text) as Array<{
          id: number;
          name: string;
          price: string;
        }>;

        console.table(
          products.map((product) => ({
            id: product.id,
            name: product.name,
            price: product.price,
          })),
        );
      }
    }

    console.log("\n=== Testing get_product ===");

    const productResult = await client.callTool({
      name: "get_product",
      arguments: {
        product_id: 14,
      },
    });

    if (productResult.isError) {
      throw new Error("get_product MCP tool failed");
    }

    if (Array.isArray(productResult.content)) {
      for (const item of productResult.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          const product = JSON.parse(item.text);

          console.log({
            id: product.id,
            name: product.name,
            price: product.price,
            status: product.status,
          });
        }
      }
    }

    console.log("\n=== Testing list_orders ===");

    const ordersResult = await client.callTool({
      name: "list_orders",
      arguments: {
        per_page: 5,
      },
    });

    if (ordersResult.isError) {
      throw new Error("list_orders MCP tool failed");
    }

    if (Array.isArray(ordersResult.content)) {
      for (const item of ordersResult.content) {
        if (
          typeof item === "object" &&
          item !== null &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          typeof item.text === "string"
        ) {
          const orders = JSON.parse(item.text);

          console.table(
            orders.map(
              (order: {
                id: number;
                status: string;
                total: string;
                currency: string;
              }) => ({
                id: order.id,
                status: order.status,
                total: order.total,
                currency: order.currency,
              }),
            ),
          );
        }
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("MCP test failed:", error);
  process.exitCode = 1;
});
