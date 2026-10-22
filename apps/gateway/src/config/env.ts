import dotenv from "dotenv";
import { z } from "zod";

// Local development reads the workspace .env, then the repository root .env
// (where the LLM keys live). In Kubernetes neither exists: values come from
// Secrets injected as environment variables. Existing variables always win.
dotenv.config({ path: [".env", "../../.env"], quiet: true });

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

  // MCP servers shipped with the platform, as a JSON array reconciled on every
  // start (see mcp/bundled-servers.ts). Credentials are not in the JSON: each
  // entry names the environment variable (from a Secret) that holds its token.
  BUNDLED_SERVERS: z.string().optional(),

  // Legacy seed: registers WooCommerce as the first server on an empty DB.
  // Ignored once BUNDLED_SERVERS has registered any server.
  WOOCOMMERCE_MCP_URL: z.url().optional(),
  WOOCOMMERCE_MCP_TOKEN: z.string().min(1).optional(),

  // Optional seed: creates the first admin user on an empty DB. The password
  // comes from a Kubernetes Secret and is only read on first boot.
  BOOTSTRAP_ADMIN_EMAIL: z.email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(10).optional(),

  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(12),
  INVITE_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),

  // Built dashboard to serve on the same origin (e.g. ../dashboard/dist).
  // Unset: the gateway serves only the API and MCP endpoint.
  DASHBOARD_DIR: z.string().min(1).optional(),

  // Set to "true" behind HTTPS so the session cookie is never sent in clear.
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),

  // Chat agent. Providers are tried in this order and, within a provider, its
  // models in order (comma-separated); a provider without an API key is
  // skipped. Model IDs are configuration, not code, because they get retired.
  // Defaults were checked against both free tiers in October 2026.
  LLM_PROVIDERS: z.string().default("gemini,groq"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODELS: z.string().min(1).default("gemini-3.6-flash,gemini-3.5-flash-lite"),
  GEMINI_THINKING_LEVEL: z.enum(["low", "medium", "high", "default"]).default("low"),
  GROQ_API_KEY: z.string().min(1).optional(),
  // Each Groq model has its own tokens-per-minute bucket on the free tier.
  GROQ_MODELS: z.string().min(1).default("openai/gpt-oss-120b,openai/gpt-oss-20b"),
  GROQ_MAX_COMPLETION_TOKENS: z.coerce.number().int().min(256).default(2048),
  // Free-tier models can take 20-40s per call under load.
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(60000),
  CHAT_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(20).default(8),
  // Timezone used to tell the model what "today" is (match the store's).
  CHAT_TIMEZONE: z.string().min(1).default("UTC"),
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
