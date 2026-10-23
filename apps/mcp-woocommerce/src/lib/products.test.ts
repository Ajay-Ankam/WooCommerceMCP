import assert from "node:assert/strict";
import test from "node:test";

import { toProductSummary } from "./products.js";

test("product summaries carry the store currency and drop raw WooCommerce fields", () => {
  const summary = toProductSummary(
    {
      id: 22,
      name: "AJAY Demo Mug",
      status: "draft",
      price: "12.99",
      regular_price: "12.99",
      sale_price: "",
      price_html: "<span>&#8377;12.99</span>",
      meta_data: [{ key: "_internal", value: "x" }],
      categories: [{ id: 15, name: "Uncategorized" }],
    } as unknown as Parameters<typeof toProductSummary>[0],
    "INR",
  );

  assert.equal(summary.currency, "INR");
  assert.equal(summary.price, "12.99");
  assert.deepEqual(summary.categories, ["Uncategorized"]);
  assert.equal(summary.stock_quantity, null);
  assert.ok(!("price_html" in summary));
  assert.ok(!("meta_data" in summary));
});
