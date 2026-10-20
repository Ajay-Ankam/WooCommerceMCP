import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wooCommerceGet } from "../lib/woocommerce.js";

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "list_products",
    {
      description: "List products from the WooCommerce store",
      inputSchema: {
        per_page: z.number().int().min(1).max(100).default(10),
      },
    },
    async ({ per_page }) => {
      try {
        const products = await wooCommerceGet(`products?per_page=${per_page}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(products, null, 2),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_product",
    {
      description: "Get a WooCommerce product by ID",
      inputSchema: {
        product_id: z.number().int().positive(),
      },
    },
    async ({ product_id }) => {
      try {
        const product = await wooCommerceGet(`products/${product_id}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(product, null, 2),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "list_orders",
    {
      description: "List WooCommerce store orders",
      inputSchema: {
        per_page: z.number().int().min(1).max(100).default(10),
        status: z
          .enum([
            "pending",
            "processing",
            "on-hold",
            "completed",
            "cancelled",
            "refunded",
            "failed",
          ])
          .optional(),
      },
    },
    async ({ per_page, status }) => {
      try {
        const params = new URLSearchParams({
          per_page: String(per_page),
        });

        if (status) {
          params.set("status", status);
        }

        const orders = await wooCommerceGet(`orders?${params.toString()}`);

        // Return only the fields needed for order management.
        // Full WooCommerce order records contain customer PII.
        const summaries = (
          orders as Array<{
            id: number;
            status: string;
            total: string;
            currency: string;
          }>
        ).map(({ id, status, total, currency }) => ({
          id,
          status,
          total,
          currency,
        }));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(summaries, null, 2),
            },
          ],
        };
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    "get_order",
    {
      description: "Get an order's status, total, currency, and items",
      inputSchema: {
        order_id: z.number().int().positive(),
      },
    },
    async ({ order_id }) => {
      try {
        const order = await wooCommerceGet(`orders/${order_id}`);

        const result = order as {
          id: number;
          status: string;
          total: string;
          currency: string;
          line_items: Array<{
            product_id: number;
            name: string;
            quantity: number;
          }>;
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                id: result.id,
                status: result.status,
                total: result.total,
                currency: result.currency,
                items: result.line_items.map((item) => ({
                  product_id: item.product_id,
                  name: item.name,
                  quantity: item.quantity,
                })),
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
