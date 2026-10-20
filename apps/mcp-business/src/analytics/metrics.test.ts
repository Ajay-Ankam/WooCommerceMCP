import assert from "node:assert/strict";
import test from "node:test";

import {
  getOrderStatusBreakdown,
  getSalesTrend,
  getTopProducts,
  ordersSchema,
  summarizeSales,
} from "./metrics.js";

// Raw input in woocommerce__list_orders shape (money as strings).
const orders = ordersSchema.parse([
  {
    id: 1, status: "processing", total: "100.10", currency: "INR", date_created: "2026-10-18T09:00:00",
    line_items: [{ product_id: 10, name: "Mug", quantity: 2, total: "60.10" }, { product_id: 11, name: "Tee", quantity: 1, total: "40.00" }],
  },
  {
    id: 2, status: "completed", total: "200.20", currency: "INR", date_created: "2026-10-20T23:59:59",
    line_items: [{ product_id: 11, name: "Tee", quantity: 5, total: "200.20" }],
  },
  {
    id: 3, status: "cancelled", total: "999.00", currency: "INR", date_created: "2026-10-20T10:00:00",
    line_items: [{ product_id: 10, name: "Mug", quantity: 50, total: "999.00" }],
  },
  {
    id: 1, status: "processing", total: "100.10", currency: "INR", date_created: "2026-10-18T09:00:00",
    line_items: [{ product_id: 10, name: "Mug", quantity: 2, total: "60.10" }, { product_id: 11, name: "Tee", quantity: 1, total: "40.00" }],
  },
]);

test("summarize_sales counts only paid statuses and dedupes overlapping pages", () => {
  const summary = summarizeSales(orders);

  assert.equal(summary.orders_received, 3);
  assert.equal(summary.revenue_orders, 2);
  assert.equal(summary.gross_revenue, 300.3);
  assert.equal(summary.average_order_value, 150.15);
  assert.equal(summary.items_sold, 8);
  assert.deepEqual(summary.excluded_by_status, { cancelled: 1 });
  assert.equal(summary.duplicates_ignored, 1);
  assert.deepEqual(summary.period, { from: "2026-10-18", to: "2026-10-20" });
});

test("get_top_products ranks paid line items with bounded output", () => {
  const byRevenue = getTopProducts(orders, { limit: 1, rank_by: "revenue" });

  assert.equal(byRevenue.products_sold, 2);
  assert.deepEqual(byRevenue.products, [
    { rank: 1, product_id: 11, name: "Tee", quantity_sold: 6, revenue: 240.2, order_count: 2, revenue_share_percent: 79.99 },
  ]);

  const byQuantity = getTopProducts(orders, { limit: 5, rank_by: "quantity" });
  assert.deepEqual(byQuantity.products.map((p) => p.product_id), [11, 10]);
});

test("get_order_status_breakdown includes non-revenue statuses", () => {
  const breakdown = getOrderStatusBreakdown(orders);

  assert.equal(breakdown.total_orders, 3);
  assert.deepEqual(
    breakdown.statuses.map((s) => [s.status, s.order_count, s.total_value, s.counts_as_revenue]),
    [["cancelled", 1, 999, false], ["completed", 1, 200.2, true], ["processing", 1, 100.1, true]],
  );
});

test("get_sales_trend fills empty days and reports change", () => {
  const trend = getSalesTrend(orders, { interval: "day" });

  assert.deepEqual(trend.buckets, [
    { period_start: "2026-10-18", orders: 1, revenue: 100.1, change_percent: null },
    { period_start: "2026-10-19", orders: 0, revenue: 0, change_percent: -100 },
    { period_start: "2026-10-20", orders: 1, revenue: 200.2, change_percent: null },
  ]);
  assert.equal(trend.best_period, "2026-10-20");

  const weekly = getSalesTrend(orders, { interval: "week" });
  assert.deepEqual(weekly.buckets.map((b) => [b.period_start, b.revenue]), [["2026-10-12", 100.1], ["2026-10-19", 200.2]]);
});

test("mixed currencies and oversized input are rejected", () => {
  const mixed = ordersSchema.parse([
    { id: 1, status: "completed", total: "1.00", currency: "INR", date_created: "2026-10-20T00:00:00" },
    { id: 2, status: "completed", total: "1.00", currency: "USD", date_created: "2026-10-20T00:00:00" },
  ]);
  assert.throws(() => summarizeSales(mixed), /multiple currencies/);

  const tooMany = Array.from({ length: 501 }, (_, id) => ({
    id, status: "completed", total: "1.00", currency: "INR", date_created: "2026-10-20T00:00:00",
  }));
  assert.equal(ordersSchema.safeParse(tooMany).success, false);
});
