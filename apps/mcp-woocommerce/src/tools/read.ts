import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { wooCommerceGet } from "../lib/woocommerce.js";
import { normalizeDateBound, toOrderSummary } from "../lib/orders.js";

const dateBound = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/)
  .optional();

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
      description:
        "List WooCommerce store orders, newest first. Filter by status and by " +
        "creation date (store timezone): `after` and `before` accept " +
        "YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS. For today's orders pass " +
        "after=<today's date>. Output can be passed directly to the Sales " +
        "Analytics tools.",
      inputSchema: {
        per_page: z.number().int().min(1).max(100).default(10),
        page: z.number().int().min(1).max(100).default(1),
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
        after: dateBound,
        before: dateBound,
      },
    },
    async ({ per_page, page, status, after, before }) => {
      try {
        const params = new URLSearchParams({
          per_page: String(per_page),
          page: String(page),
          orderby: "date",
          order: "desc",
        });

        if (status) {
          params.set("status", status);
        }

        if (after) {
          params.set("after", normalizeDateBound(after));
        }

        if (before) {
          params.set("before", normalizeDateBound(before));
        }

        const orders = await wooCommerceGet(`orders?${params.toString()}`);

        // Return only the fields needed for order management.
        // Full WooCommerce order records contain customer PII.
        const summaries = (orders as Parameters<typeof toOrderSummary>[0][]).map(
          toOrderSummary,
        );

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
      description:
        "Get an order's status, total, currency, creation date, and items",
      inputSchema: {
        order_id: z.number().int().positive(),
      },
    },
    async ({ order_id }) => {
      try {
        const order = await wooCommerceGet(`orders/${order_id}`);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                toOrderSummary(order as Parameters<typeof toOrderSummary>[0]),
              ),
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
