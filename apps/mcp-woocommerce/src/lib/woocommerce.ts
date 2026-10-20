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

export function wooCommerceWrite(
  path: string,
  method: "POST" | "PUT",
  body: Record<string, unknown>,
): Promise<unknown> {
  return request(path, method, body);
}
