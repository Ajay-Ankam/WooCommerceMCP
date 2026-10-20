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
    name: "ajay-mcp-write-test",
    version: "1.0.0",
  });

  try {
    await client.connect(transport);

    console.log("Connected to WooCommerce MCP server.");

    const result = await client.callTool({
      name: "create_product",
      arguments: {
        name: "AJAY MCP Integration Test",
        regular_price: "299",
        description: "Created through the MCP protocol",
      },
    });

    if (result.isError) {
      console.error("create_product returned an error:", result.content);
      process.exitCode = 1;
      return;
    }

    if (!Array.isArray(result.content)) {
      throw new Error("Invalid MCP response");
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
        const product = JSON.parse(item.text) as {
          id: number;
          name: string;
          status: string;
          price: string;
        };

        console.log("Product created successfully:");
        console.table([product]);

        if (product.status !== "draft") {
          throw new Error("Created product is not a draft!");
        }

        console.log("Verified: product status is draft.");
      }
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error("MCP write test failed:", error);
  process.exitCode = 1;
});
