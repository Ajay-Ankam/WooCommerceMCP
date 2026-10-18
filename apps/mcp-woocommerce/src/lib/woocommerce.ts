import { Buffer } from "node:buffer";

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

const baseUrl = requireEnv("WOOCOMMERCE_URL");
const consumerKey = requireEnv("WOOCOMMERCE_CONSUMER_KEY");
const consumerSecret = requireEnv("WOOCOMMERCE_CONSUMER_SECRET");

async function request(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64",
  );

  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/${path}`,
    {
      method,
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );

  if (!response.ok) {
    throw new Error(
      `WooCommerce API ${method} failed: HTTP ${response.status}`,
    );
  }

  return response.json();
}

export function wooCommerceGet(path: string): Promise<unknown> {
  return request(path, "GET");
}

export function wooCommerceWrite(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
): Promise<unknown> {
  return request(path, method, body);
}
