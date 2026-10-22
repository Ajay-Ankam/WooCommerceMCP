import { createApp } from "./app.js";
import { createProviders } from "./chat/providers/index.js";
import { createGatewayContext } from "./context.js";
import { parseBundledServers } from "./mcp/bundled-servers.js";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { registerGracefulShutdown } from "./lib/graceful-shutdown.js";

const context = createGatewayContext({
  dbPath: env.GATEWAY_DB_PATH,
  upstreamTimeoutMs: env.UPSTREAM_TIMEOUT_MS,
  auth: {
    sessionTtlHours: env.SESSION_TTL_HOURS,
    inviteTtlHours: env.INVITE_TTL_HOURS,
    cookieSecure: env.COOKIE_SECURE,
  },
  chat: {
    providers: createProviders({
      order: env.LLM_PROVIDERS,
      timeoutMs: env.LLM_TIMEOUT_MS,
      gemini: {
        apiKey: env.GEMINI_API_KEY,
        models: env.GEMINI_MODELS,
        thinkingLevel: env.GEMINI_THINKING_LEVEL === "default" ? undefined : env.GEMINI_THINKING_LEVEL,
      },
      groq: {
        apiKey: env.GROQ_API_KEY,
        models: env.GROQ_MODELS,
        maxCompletionTokens: env.GROQ_MAX_COMPLETION_TOKENS,
      },
    }),
    maxToolRounds: env.CHAT_MAX_TOOL_ROUNDS,
    timezone: env.CHAT_TIMEZONE,
  },
  bundledServers: parseBundledServers(env.BUNDLED_SERVERS),
  seed: {
    woocommerceUrl: env.WOOCOMMERCE_MCP_URL,
    woocommerceToken: env.WOOCOMMERCE_MCP_TOKEN,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
  },
});

// Slugs only: URLs and credentials of bundled servers are never logged.
logger.info(context.bundledReconcile, "Bundled MCP servers reconciled");

context.upstreams.startStatusRefresh(env.STATUS_REFRESH_MS);

const app = createApp(context, { dashboardDir: env.DASHBOARD_DIR });

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info(
    { port: env.PORT, chatProviders: context.chat.configured },
    "Gateway started",
  );
});

registerGracefulShutdown(server, logger);
