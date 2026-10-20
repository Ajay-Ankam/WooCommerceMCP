import { fromCents, percentOf, percentage, toCents } from "../shared/money.js";

export type DiscountType = "percent" | "fixed";

export interface Discount {
  type: DiscountType;
  value: number;
}

// Discount on an amount in cents; rejects discounts that would go negative.
function discountCents(amountCents: number, discount: Discount): number {
  if (discount.type === "percent") {
    if (discount.value > 100) {
      throw new Error("Percent discount cannot exceed 100");
    }

    return percentOf(amountCents, discount.value);
  }

  const fixed = toCents(discount.value);

  if (fixed > amountCents) {
    throw new Error(
      `Fixed discount ${discount.value} exceeds the amount ${fromCents(amountCents)}`,
    );
  }

  return fixed;
}

export function calculateDiscount(input: {
  original_price: number;
  discount_type: DiscountType;
  discount_value: number;
}) {
  const original = toCents(input.original_price);
  const discount = discountCents(original, {
    type: input.discount_type,
    value: input.discount_value,
  });

  return {
    original_price: fromCents(original),
    discount_amount: fromCents(discount),
    final_price: fromCents(original - discount),
    effective_discount_percent: percentage(discount, original) ?? 0,
  };
}

export function calculateProfitMargin(input: {
  selling_price: number;
  cost_price: number;
  quantity: number;
}) {
  const revenue = toCents(input.selling_price) * input.quantity;
  const cost = toCents(input.cost_price) * input.quantity;
  const profit = revenue - cost;

  return {
    quantity: input.quantity,
    revenue: fromCents(revenue),
    cost: fromCents(cost),
    profit: fromCents(profit),
    // Margin is profit over selling price; markup is profit over cost.
    margin_percent: percentage(profit, revenue),
    markup_percent: percentage(profit, cost),
    is_loss: profit < 0,
  };
}

export function calculateOrderTotal(input: {
  items: Array<{ name?: string; unit_price: number; quantity: number }>;
  discount?: Discount;
  tax_rate_percent: number;
  shipping: number;
  tax_shipping: boolean;
}) {
  const lines = input.items.map((item) => {
    const lineTotal = toCents(item.unit_price) * item.quantity;

    return {
      name: item.name ?? null,
      unit_price: item.unit_price,
      quantity: item.quantity,
      line_total: fromCents(lineTotal),
      cents: lineTotal,
    };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.cents, 0);
  const discount = input.discount ? discountCents(subtotal, input.discount) : 0;
  const shipping = toCents(input.shipping);
  const taxable = subtotal - discount + (input.tax_shipping ? shipping : 0);
  const tax = percentOf(taxable, input.tax_rate_percent);

  return {
    line_items: lines.map(({ cents: _cents, ...line }) => line),
    subtotal: fromCents(subtotal),
    discount: fromCents(discount),
    taxable_amount: fromCents(taxable),
    tax_rate_percent: input.tax_rate_percent,
    tax: fromCents(tax),
    shipping: fromCents(shipping),
    total: fromCents(subtotal - discount + shipping + tax),
    rules: "Discount is applied to the subtotal before tax; shipping is taxed only when tax_shipping is true.",
  };
}

// Clearly labelled sample rates (units per 1 USD). They are fixed so demos and
// tests are reproducible; they are NOT live market rates.
export const SAMPLE_RATES = {
  as_of: "2026-10-01",
  base: "USD",
  rates: {
    USD: 1,
    EUR: 0.92,
    GBP: 0.79,
    INR: 83.5,
    AUD: 1.52,
    CAD: 1.37,
    SGD: 1.34,
  } as Record<string, number>,
  disclaimer: "Sample rates for demonstration only; not live market data.",
};

export function convertCurrency(input: {
  amount: number;
  from: string;
  to: string;
  rate?: number;
}) {
  let rate: number;
  let source: "explicit" | "sample";

  if (input.rate !== undefined) {
    rate = input.rate;
    source = "explicit";
  } else {
    const from = SAMPLE_RATES.rates[input.from];
    const to = SAMPLE_RATES.rates[input.to];

    if (from === undefined || to === undefined) {
      throw new Error(
        `No sample rate for ${from === undefined ? input.from : input.to}. ` +
          `Supported: ${Object.keys(SAMPLE_RATES.rates).join(", ")}, or pass an explicit rate.`,
      );
    }

    rate = to / from;
    source = "sample";
  }

  const converted = Math.round(Number((toCents(input.amount) * rate).toFixed(6)));

  return {
    amount: input.amount,
    from: input.from,
    to: input.to,
    rate: Math.round(rate * 1e6) / 1e6,
    converted_amount: fromCents(converted),
    rate_source: source,
    note:
      source === "sample"
        ? `${SAMPLE_RATES.disclaimer} Rates as of ${SAMPLE_RATES.as_of}.`
        : "Converted with the caller-supplied rate.",
  };
}
