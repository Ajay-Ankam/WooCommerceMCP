import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  // 3000 avoids clashing with the WooCommerce MCP server (3001).
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // SQLite file holding users, API keys, upstream servers and the audit log.
  GATEWAY_DB_PATH: z.string().min(1).default("./data/gateway.db"),

  // Per-request timeout for every upstream MCP call (connect, list, call).
  UPSTREAM_TIMEOUT_MS: z.coerce.number().int().min(100).default(10000),

  // How often upstream status (Connected / Unreachable) is refreshed.
  STATUS_REFRESH_MS: z.coerce.number().int().min(1000).default(15000),

  // Optional seed: registers WooCommerce as the first server on an empty DB.
  WOOCOMMERCE_MCP_URL: z.url().optional(),
  WOOCOMMERCE_MCP_TOKEN: z.string().min(1).optional(),

  // Optional seed: creates the first admin user on an empty DB.
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
});

export type GatewayEnv = z.infer<typeof envSchema>;

export function parseEnv(input: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid gateway environment configuration:\n${details}`);
  }

  return result.data;
}

export const env = parseEnv();
