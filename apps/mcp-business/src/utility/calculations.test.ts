import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateDiscount,
  calculateOrderTotal,
  calculateProfitMargin,
  convertCurrency,
} from "./calculations.js";

test("percent and fixed discounts are exact to the cent", () => {
  assert.deepEqual(
    calculateDiscount({ original_price: 19.99, discount_type: "percent", discount_value: 15 }),
    { original_price: 19.99, discount_amount: 3, final_price: 16.99, effective_discount_percent: 15.01 },
  );
  assert.equal(
    calculateDiscount({ original_price: 50, discount_type: "fixed", discount_value: 12.5 }).final_price,
    37.5,
  );
  assert.throws(
    () => calculateDiscount({ original_price: 10, discount_type: "fixed", discount_value: 11 }),
    /exceeds/,
  );
  assert.throws(
    () => calculateDiscount({ original_price: 10, discount_type: "percent", discount_value: 101 }),
    /cannot exceed 100/,
  );
});

test("profit margin and markup use different denominators", () => {
  const result = calculateProfitMargin({ selling_price: 100, cost_price: 60, quantity: 3 });

  assert.equal(result.profit, 120);
  assert.equal(result.margin_percent, 40);
  assert.equal(result.markup_percent, 66.67);
  assert.equal(result.is_loss, false);
  assert.equal(calculateProfitMargin({ selling_price: 5, cost_price: 0, quantity: 1 }).markup_percent, null);
});

test("order total applies discount before tax and avoids float drift", () => {
  const result = calculateOrderTotal({
    items: [
      { name: "Mug", unit_price: 0.1, quantity: 3 },
      { name: "Tee", unit_price: 19.99, quantity: 2 },
    ],
    discount: { type: "percent", value: 10 },
    tax_rate_percent: 18,
    shipping: 5,
    tax_shipping: false,
  });

  assert.equal(result.subtotal, 40.28);
  assert.equal(result.discount, 4.03);
  assert.equal(result.taxable_amount, 36.25);
  assert.equal(result.tax, 6.53);
  assert.equal(result.total, 47.78);
});

test("currency conversion labels sample rates and honours explicit rates", () => {
  const sample = convertCurrency({ amount: 479, from: "INR", to: "EUR" });
  assert.equal(sample.rate_source, "sample");
  assert.equal(sample.converted_amount, 5.28);
  assert.match(sample.note, /not live/);

  const explicit = convertCurrency({ amount: 10, from: "USD", to: "XYZ", rate: 2.5 });
  assert.deepEqual([explicit.converted_amount, explicit.rate_source], [25, "explicit"]);

  assert.throws(() => convertCurrency({ amount: 1, from: "USD", to: "XYZ" }), /No sample rate for XYZ/);
});
