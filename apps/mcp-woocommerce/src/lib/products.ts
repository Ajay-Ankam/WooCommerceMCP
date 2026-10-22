// Product shape returned by the MCP tools. WooCommerce product records carry
// no currency and are very large; summaries add the store currency so the
// model never has to guess a symbol, and keep only what a team member needs.
export interface ProductSummary {
  id: number;
  name: string;
  status: string;
  sku: string;
  price: string;
  regular_price: string;
  sale_price: string;
  currency: string;
  stock_status: string;
  stock_quantity: number | null;
  categories: string[];
  permalink: string;
  date_created: string;
}

interface WooProduct {
  id: number;
  name: string;
  status: string;
  sku?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_status?: string;
  stock_quantity?: number | null;
  categories?: Array<{ name: string }>;
  permalink?: string;
  date_created?: string;
}

export function toProductSummary(product: WooProduct, currency: string): ProductSummary {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    sku: product.sku ?? "",
    price: product.price ?? "",
    regular_price: product.regular_price ?? "",
    sale_price: product.sale_price ?? "",
    currency,
    stock_status: product.stock_status ?? "",
    stock_quantity: product.stock_quantity ?? null,
    categories: (product.categories ?? []).map((category) => category.name),
    permalink: product.permalink ?? "",
    date_created: product.date_created ?? "",
  };
}
