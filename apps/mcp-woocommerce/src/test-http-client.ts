import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  
const token = process.env.MCP_AUTH_TOKEN;

if (!token) {
  throw new Error("MCP_AUTH_TOKEN is required");
}

const transport = new StreamableHTTPClientTransport(
  new URL("http://localhost:3001/mcp"),
  {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  },
);


  const client = new Client({
    name: "ajay-http-mcp-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    console.log("Connected to MCP server over HTTP.");

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
      throw new Error(
        `list_products failed: ${JSON.stringify(result.content)}`,
      );
    }

    if (!Array.isArray(result.content)) {
      throw new Error("Invalid MCP response: content is not an array");
    }

    console.log("\nWooCommerce products retrieved over HTTP:");

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
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("HTTP MCP test failed:", error);
  process.exitCode = 1;
});
