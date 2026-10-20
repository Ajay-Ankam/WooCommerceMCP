import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { amountSchema } from "../shared/money.js";
import { toolHandler } from "../shared/results.js";
import {
  SAMPLE_RATES,
  calculateDiscount,
  calculateOrderTotal,
  calculateProfitMargin,
  convertCurrency,
} from "./calculations.js";

export const UTILITY_SERVER = { name: "ajay-utility-mcp", version: "1.0.0" };

const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/)
  .describe("ISO 4217 currency code, e.g. USD");

const discountSchema = z.object({
  type: z.enum(["percent", "fixed"]),
  value: z.number().finite().min(0).max(1_000_000_000),
});

export function registerUtilityTools(server: McpServer): void {
  server.registerTool(
    "calculate_discount",
    {
      description: "Apply a percent or fixed discount to a price and return the final price.",
      inputSchema: {
        original_price: amountSchema,
        discount_type: z.enum(["percent", "fixed"]),
        discount_value: z.number().finite().min(0).max(1_000_000_000),
      },
    },
    toolHandler(calculateDiscount),
  );

  server.registerTool(
    "calculate_profit_margin",
    {
      description:
        "Compute profit, margin (profit / selling price) and markup (profit / cost) for a product.",
      inputSchema: {
        selling_price: amountSchema,
        cost_price: amountSchema,
        quantity: z.number().int().min(1).max(1_000_000).default(1),
      },
    },
    toolHandler(calculateProfitMargin),
  );

  server.registerTool(
    "calculate_order_total",
    {
      description:
        "Price a cart: line totals, subtotal, optional discount, tax and shipping.",
      inputSchema: {
        items: z
          .array(
            z.object({
              name: z.string().max(200).optional(),
              unit_price: amountSchema,
              quantity: z.number().int().min(1).max(10_000),
            }),
          )
          .min(1)
          .max(100),
        discount: discountSchema.optional(),
        tax_rate_percent: z.number().finite().min(0).max(100).default(0),
        shipping: amountSchema.default(0),
        tax_shipping: z.boolean().default(false),
      },
    },
    toolHandler(calculateOrderTotal),
  );

  server.registerTool(
    "convert_currency",
    {
      description:
        "Convert an amount between currencies. Pass `rate` (units of `to` per 1 `from`) " +
        "for an exact conversion; otherwise clearly labelled SAMPLE rates are used, not live rates.",
      inputSchema: {
        amount: amountSchema,
        from: currencyCode,
        to: currencyCode,
        rate: z.number().finite().positive().max(1_000_000).optional(),
      },
    },
    toolHandler(convertCurrency),
  );

  // Deliberate name collision with the Analytics server: each server describes
  // its own conventions. The gateway exposes them as utility__get_server_info
  // and analytics__get_server_info.
  server.registerTool(
    "get_server_info",
    {
      description: "Describe the Utility server: rounding rules and the sample exchange rates.",
      inputSchema: {},
    },
    toolHandler(() => ({
      server: UTILITY_SERVER.name,
      version: UTILITY_SERVER.version,
      purpose: "Deterministic business calculations for store owners.",
      rounding: "Integer cents; percentages rounded half-up to 2 decimals.",
      sample_rates: SAMPLE_RATES,
    })),
  );
}
