import { z } from "zod";

import { fromCents, moneyInputSchema, percentage } from "../shared/money.js";

export const MAX_ORDERS = 500;
export const MAX_LINE_ITEMS = 100;
export const MAX_TREND_BUCKETS = 366;

// Statuses WooCommerce itself treats as paid sales in its reports.
export const REVENUE_STATUSES = ["processing", "completed", "on-hold"];

// Same shape as woocommerce__list_orders / get_order output, so the model can
// pass orders through unchanged. Unknown fields are stripped.
export const orderSchema = z.object({
  id: z.number().int().nonnegative(),
  status: z.string().min(1).max(40),
  total: moneyInputSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  date_created: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, "date_created must be ISO 8601"),
  line_items: z
    .array(
      z.object({
        product_id: z.number().int().nonnegative(),
        name: z.string().max(200),
        quantity: z.number().int().min(0).max(1_000_000),
        total: moneyInputSchema,
      }),
    )
    .max(MAX_LINE_ITEMS)
    .default([]),
});

export const ordersSchema = z
  .array(orderSchema)
  .min(1)
  .max(MAX_ORDERS)
  .describe("Orders exactly as returned by woocommerce__list_orders");

export type Order = z.output<typeof orderSchema>;

interface PreparedOrders {
  currency: string;
  orders: Order[];
  revenueOrders: Order[];
  duplicatesIgnored: number;
}

// Dedupes overlapping pages and refuses to add up different currencies.
function prepare(input: Order[]): PreparedOrders {
  const byId = new Map<number, Order>();

  for (const order of input) {
    byId.set(order.id, order);
  }

  const orders = [...byId.values()];
  const currencies = [...new Set(orders.map((o) => o.currency))];

  if (currencies.length > 1) {
    throw new Error(
      `Orders use multiple currencies (${currencies.join(", ")}); analyse one currency at a time.`,
    );
  }

  return {
    currency: currencies[0],
    orders,
    revenueOrders: orders.filter((o) => REVENUE_STATUSES.includes(o.status)),
    duplicatesIgnored: input.length - orders.length,
  };
}

const storeDate = (order: Order) => order.date_created.slice(0, 10);
const sumTotals = (orders: Order[]) => orders.reduce((s, o) => s + o.total, 0);

export function summarizeSales(input: Order[]) {
  const { currency, orders, revenueOrders, duplicatesIgnored } = prepare(input);
  const revenue = sumTotals(revenueOrders);
  const dates = orders.map(storeDate).sort();
  const excluded: Record<string, number> = {};

  for (const order of orders) {
    if (!REVENUE_STATUSES.includes(order.status)) {
      excluded[order.status] = (excluded[order.status] ?? 0) + 1;
    }
  }

  return {
    currency,
    period: { from: dates[0], to: dates[dates.length - 1] },
    orders_received: orders.length,
    revenue_orders: revenueOrders.length,
    gross_revenue: fromCents(revenue),
    average_order_value:
      revenueOrders.length > 0 ? fromCents(Math.round(revenue / revenueOrders.length)) : 0,
    items_sold: revenueOrders.reduce(
      (s, o) => s + o.line_items.reduce((n, i) => n + i.quantity, 0),
      0,
    ),
    excluded_by_status: excluded,
    revenue_statuses: REVENUE_STATUSES,
    duplicates_ignored: duplicatesIgnored,
  };
}

export function getTopProducts(
  input: Order[],
  options: { limit: number; rank_by: "revenue" | "quantity" },
) {
  const { currency, revenueOrders } = prepare(input);
  const products = new Map<
    number,
    { product_id: number; name: string; quantity: number; revenue: number; orders: Set<number> }
  >();

  for (const order of revenueOrders) {
    for (const item of order.line_items) {
      const entry = products.get(item.product_id) ?? {
        product_id: item.product_id,
        name: item.name,
        quantity: 0,
        revenue: 0,
        orders: new Set<number>(),
      };

      entry.quantity += item.quantity;
      entry.revenue += item.total;
      entry.orders.add(order.id);
      products.set(item.product_id, entry);
    }
  }

  const totalRevenue = [...products.values()].reduce((s, p) => s + p.revenue, 0);
  const primary = options.rank_by === "revenue" ? "revenue" : "quantity";
  const secondary = primary === "revenue" ? "quantity" : "revenue";

  const ranked = [...products.values()].sort(
    (a, b) => b[primary] - a[primary] || b[secondary] - a[secondary] || a.product_id - b.product_id,
  );

  return {
    currency,
    rank_by: options.rank_by,
    products_sold: ranked.length,
    products: ranked.slice(0, options.limit).map((p, index) => ({
      rank: index + 1,
      product_id: p.product_id,
      name: p.name,
      quantity_sold: p.quantity,
      revenue: fromCents(p.revenue),
      order_count: p.orders.size,
      revenue_share_percent: percentage(p.revenue, totalRevenue),
    })),
    revenue_statuses: REVENUE_STATUSES,
  };
}

export function getOrderStatusBreakdown(input: Order[]) {
  const { currency, orders } = prepare(input);
  const statuses = new Map<string, { count: number; value: number }>();

  for (const order of orders) {
    const entry = statuses.get(order.status) ?? { count: 0, value: 0 };
    entry.count += 1;
    entry.value += order.total;
    statuses.set(order.status, entry);
  }

  return {
    currency,
    total_orders: orders.length,
    statuses: [...statuses.entries()]
      .sort(([a, x], [b, y]) => y.count - x.count || a.localeCompare(b))
      .map(([status, { count, value }]) => ({
        status,
        order_count: count,
        order_share_percent: percentage(count, orders.length),
        total_value: fromCents(value),
        counts_as_revenue: REVENUE_STATUSES.includes(status),
      })),
  };
}

type Interval = "day" | "week" | "month";

const DAY_MS = 86_400_000;

// Dates are bucketed on the store-local calendar date in date_created; Date is
// used in UTC purely for calendar arithmetic, so no timezone shift occurs.
function bucketStart(date: string, interval: Interval): number {
  const [y, m, d] = date.split("-").map(Number);

  if (interval === "month") {
    return Date.UTC(y, m - 1, 1);
  }

  const day = Date.UTC(y, m - 1, d);

  if (interval === "week") {
    const weekday = (new Date(day).getUTCDay() + 6) % 7; // Monday = 0
    return day - weekday * DAY_MS;
  }

  return day;
}

function nextBucket(start: number, interval: Interval): number {
  if (interval === "month") {
    const date = new Date(start);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
  }

  return start + (interval === "week" ? 7 : 1) * DAY_MS;
}

export function getSalesTrend(input: Order[], options: { interval: Interval }) {
  const { currency, revenueOrders } = prepare(input);
  const totals = new Map<number, { orders: number; revenue: number }>();

  for (const order of revenueOrders) {
    const key = bucketStart(storeDate(order), options.interval);
    const entry = totals.get(key) ?? { orders: 0, revenue: 0 };
    entry.orders += 1;
    entry.revenue += order.total;
    totals.set(key, entry);
  }

  if (totals.size === 0) {
    return { currency, interval: options.interval, buckets: [], revenue_statuses: REVENUE_STATUSES };
  }

  const keys = [...totals.keys()].sort((a, b) => a - b);
  const buckets: Array<{
    period_start: string;
    orders: number;
    revenue: number;
    change_percent: number | null;
  }> = [];
  let previous: number | null = null;

  // Fill empty periods so the trend is continuous.
  for (let key = keys[0]; key <= keys[keys.length - 1]; key = nextBucket(key, options.interval)) {
    if (buckets.length >= MAX_TREND_BUCKETS) {
      throw new Error(
        `Trend spans more than ${MAX_TREND_BUCKETS} ${options.interval}s; use a larger interval.`,
      );
    }

    const entry = totals.get(key) ?? { orders: 0, revenue: 0 };

    buckets.push({
      period_start: new Date(key).toISOString().slice(0, 10),
      orders: entry.orders,
      revenue: fromCents(entry.revenue),
      change_percent: previous === null ? null : percentage(entry.revenue - previous, previous),
    });
    previous = entry.revenue;
  }

  const best = buckets.reduce((a, b) => (b.revenue > a.revenue ? b : a));

  return {
    currency,
    interval: options.interval,
    buckets,
    best_period: best.period_start,
    total_revenue: fromCents(sumTotals(revenueOrders)),
    revenue_statuses: REVENUE_STATUSES,
  };
}
