// Order shape returned by the MCP tools. Customer PII (names, emails,
// addresses) is deliberately dropped; this is also the input contract of the
// Sales Analytics MCP server, so list_orders output can be passed straight in.
export interface OrderSummary {
  id: number;
  status: string;
  total: string;
  currency: string;
  date_created: string;
  line_items: Array<{
    product_id: number;
    name: string;
    quantity: number;
    total: string;
  }>;
}

interface WooOrder {
  id: number;
  status: string;
  total: string;
  currency: string;
  date_created: string;
  line_items?: Array<{
    product_id: number;
    name: string;
    quantity: number;
    total: string;
  }>;
}

export function toOrderSummary(order: WooOrder): OrderSummary {
  return {
    id: order.id,
    status: order.status,
    total: order.total,
    currency: order.currency,
    date_created: order.date_created,
    line_items: (order.line_items ?? []).map((item) => ({
      product_id: item.product_id,
      name: item.name,
      quantity: item.quantity,
      total: item.total,
    })),
  };
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// WooCommerce expects ISO 8601 date-times in the store's timezone. Accept a
// plain date for convenience: "2026-10-20" becomes the start of that day.
export function normalizeDateBound(value: string): string {
  if (DATE_ONLY.test(value)) {
    return `${value}T00:00:00`;
  }

  if (DATE_TIME.test(value)) {
    return value.length === 16 ? `${value}:00` : value;
  }

  throw new Error(
    `Invalid date "${value}": use YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS (store time)`,
  );
}
