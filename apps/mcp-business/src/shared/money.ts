import { z } from "zod";

// All arithmetic is done in integer minor units (cents) so results are exact
// and repeatable; floating point is only used to parse and present values.
export type Cents = number;

const MAX_AMOUNT = 1_000_000_000;

export function toCents(amount: number): Cents {
  const cents = Math.round(amount * 100);

  if (Math.abs(amount * 100 - cents) > 1e-6) {
    throw new Error(`Amount ${amount} has more than 2 decimal places`);
  }

  return cents;
}

export function fromCents(cents: Cents): number {
  return cents / 100;
}

// Half-up rounding of a percentage of an amount, back to whole cents.
export function percentOf(cents: Cents, percent: number): Cents {
  // toFixed(6) strips binary noise (e.g. 0.4999999) before rounding.
  return Math.round(Number(((cents * percent) / 100).toFixed(6)));
}

// Ratio as a percentage with 2 decimals, or null when undefined (x / 0).
export function percentage(part: number, whole: number): number | null {
  if (whole === 0) {
    return null;
  }

  return Math.round((part / whole) * 10000) / 100;
}

export const amountSchema = z
  .number()
  .finite()
  .min(0)
  .max(MAX_AMOUNT)
  .describe("Amount in major units, at most 2 decimals, e.g. 19.99");

// WooCommerce sends money as decimal strings ("479.00"); accept numbers too.
export const moneyInputSchema = z
  .union([z.string().regex(/^\d+(\.\d{1,2})?$/), amountSchema])
  .transform((value) => toCents(typeof value === "string" ? Number(value) : value));
