import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toolHandler } from "../shared/results.js";
import {
  MAX_LINE_ITEMS,
  MAX_ORDERS,
  MAX_TREND_BUCKETS,
  REVENUE_STATUSES,
  getOrderStatusBreakdown,
  getSalesTrend,
  getTopProducts,
  ordersSchema,
  summarizeSales,
} from "./metrics.js";

export const ANALYTICS_SERVER = { name: "ajay-analytics-mcp", version: "1.0.0" };

// This server has no WooCommerce credentials: it only analyses order data the
// caller fetched through the gateway (woocommerce__list_orders).
const ordersInput = { orders: ordersSchema };
const usage = "Pass `orders` exactly as returned by woocommerce__list_orders.";

export function registerAnalyticsTools(server: McpServer): void {
  server.registerTool(
    "summarize_sales",
    {
      description: `Revenue, paid order count, average order value and items sold. ${usage}`,
      inputSchema: ordersInput,
    },
    toolHandler(({ orders }) => summarizeSales(orders)),
  );

  server.registerTool(
    "get_top_products",
    {
      description: `Best-selling products by revenue or quantity from paid orders. ${usage}`,
      inputSchema: {
        ...ordersInput,
        limit: z.number().int().min(1).max(20).default(5),
        rank_by: z.enum(["revenue", "quantity"]).default("revenue"),
      },
    },
    toolHandler(({ orders, limit, rank_by }) => getTopProducts(orders, { limit, rank_by })),
  );

  server.registerTool(
    "get_order_status_breakdown",
    {
      description: `Order count, share and value per order status. ${usage}`,
      inputSchema: ordersInput,
    },
    toolHandler(({ orders }) => getOrderStatusBreakdown(orders)),
  );

  server.registerTool(
    "get_sales_trend",
    {
      description: `Paid revenue per day, week or month with period-over-period change. ${usage}`,
      inputSchema: {
        ...ordersInput,
        interval: z.enum(["day", "week", "month"]).default("day"),
      },
    },
    toolHandler(({ orders, interval }) => getSalesTrend(orders, { interval })),
  );

  // Deliberate name collision with the Utility server (see utility/server.ts).
  server.registerTool(
    "get_server_info",
    {
      description: "Describe the Analytics server: input contract, revenue rules and limits.",
      inputSchema: {},
    },
    toolHandler(() => ({
      server: ANALYTICS_SERVER.name,
      version: ANALYTICS_SERVER.version,
      purpose: "Deterministic WooCommerce sales analysis over order data supplied by the caller.",
      data_access: "No store credentials; analyses only the orders passed in.",
      input_contract: "Orders as returned by woocommerce__list_orders (id, status, total, currency, date_created, line_items).",
      revenue_statuses: REVENUE_STATUSES,
      dates: "Grouped by the store-local calendar date in date_created.",
      limits: { max_orders: MAX_ORDERS, max_line_items_per_order: MAX_LINE_ITEMS, max_trend_buckets: MAX_TREND_BUCKETS },
    })),
  );
}
