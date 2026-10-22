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

// Kept below the gateway's upstream timeout (10s) so a slow store produces a
// clear WooCommerce error instead of a generic gateway timeout.
const timeoutMs = Number(process.env.WOOCOMMERCE_TIMEOUT_MS ?? 8000);

// WooCommerce only accepts Basic auth on HTTPS requests. Inside the cluster the
// server can call the WordPress Service over plain HTTP and declare the
// original scheme instead, which wp-config.php honours (X-Forwarded-Proto),
// so no TLS proxy or extra CA bundle is needed. Unset when the URL is HTTPS.
const forwardedProto = process.env.WOOCOMMERCE_FORWARDED_PROTO?.trim();

async function request(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: Record<string, unknown>,
): Promise<unknown> {
  const credentials = Buffer.from(`${consumerKey}:${consumerSecret}`).toString(
    "base64",
  );

  let response: Response;

  try {
    response = await fetch(
      `${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/${path}`,
      {
        method,
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          Authorization: `Basic ${credentials}`,
          Accept: "application/json",
          ...(forwardedProto ? { "X-Forwarded-Proto": forwardedProto } : {}),
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `WooCommerce API ${method} timed out after ${timeoutMs}ms`,
      );
    }

    throw new Error(`WooCommerce API ${method} failed: store unreachable`);
  }

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

// The store currency rarely changes, so it is cached briefly instead of being
// fetched for every product call.
const CURRENCY_TTL_MS = 5 * 60 * 1000;
let cachedCurrency: { code: string; expiresAt: number } | undefined;

// ISO 4217 code of the store currency (e.g. "INR"). Products carry no currency
// of their own; "unknown" tells the model not to assume one if lookup fails.
export async function getStoreCurrency(): Promise<string> {
  if (cachedCurrency && cachedCurrency.expiresAt > Date.now()) {
    return cachedCurrency.code;
  }

  try {
    const { code } = (await wooCommerceGet("data/currencies/current")) as { code?: unknown };

    if (typeof code !== "string" || !/^[A-Z]{3}$/.test(code)) {
      return "unknown";
    }

    cachedCurrency = { code, expiresAt: Date.now() + CURRENCY_TTL_MS };
    return code;
  } catch {
    return "unknown";
  }
}

export function wooCommerceWrite(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
): Promise<unknown> {
  return request(path, method, body);
}
