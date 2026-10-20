import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wooCommerceWrite } from "../lib/woocommerce.js";

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "create_product",
    {
      description: "Create a new WooCommerce product as a draft",
      inputSchema: {
        name: z.string().min(1).max(200),
        regular_price: z.string().regex(/^\d+(\.\d{1,2})?$/),
        description: z.string().optional(),
      },
    },
    async ({ name, regular_price, description }) => {
      try {
        const product = await wooCommerceWrite("products", "POST", {
          name,
          type: "simple",
          status: "draft",
          regular_price,
          description: description ?? "",
        });

        const result = product as {
          id: number;
          name: string;
          status: string;
          price: string;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id: result.id,
                name: result.name,
                status: result.status,
                price: result.price,
              }),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "update_order_status",
    {
      description: "Update a WooCommerce order status",
      inputSchema: {
        order_id: z.number().int().positive(),
        status: z.enum([
          "pending",
          "processing",
          "on-hold",
          "completed",
          "cancelled",
        ]),
      },
    },
    async ({ order_id, status }) => {
      try {
        const order = await wooCommerceWrite(`orders/${order_id}`, "PUT", {
          status,
        });

        const result = order as {
          id: number;
          status: string;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id: result.id,
                status: result.status,
              }),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text:
          error instanceof Error ? error.message : "WooCommerce request failed",
      },
    ],
  };
}
