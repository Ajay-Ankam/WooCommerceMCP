import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDateBound, toOrderSummary } from "./orders.js";

test("order summaries keep sales fields and drop customer PII", () => {
  const summary = toOrderSummary({
    id: 16,
    status: "processing",
    total: "479.00",
    currency: "INR",
    payment_method: "cod",
    payment_method_title: "Cash on delivery",
    date_created: "2026-10-20T10:15:00",
    billing: { email: "customer@example.com" },
    line_items: [
      { product_id: 13, name: "Mug", quantity: 2, total: "479.00", sku: "M1" },
    ],
  } as unknown as Parameters<typeof toOrderSummary>[0]);

  assert.deepEqual(summary, {
    id: 16,
    status: "processing",
    total: "479.00",
    currency: "INR",
    payment_method: "cod",
    payment_method_title: "Cash on delivery",
    date_created: "2026-10-20T10:15:00",
    line_items: [{ product_id: 13, name: "Mug", quantity: 2, total: "479.00" }],
  });
  assert.ok(!JSON.stringify(summary).includes("customer@example.com"));
});

test("date bounds accept dates and date-times in store time", () => {
  assert.equal(normalizeDateBound("2026-10-20"), "2026-10-20T00:00:00");
  assert.equal(normalizeDateBound("2026-10-20T09:30"), "2026-10-20T09:30:00");
  assert.equal(normalizeDateBound("2026-10-20T09:30:15"), "2026-10-20T09:30:15");
  assert.throws(() => normalizeDateBound("yesterday"), /Invalid date/);
});
