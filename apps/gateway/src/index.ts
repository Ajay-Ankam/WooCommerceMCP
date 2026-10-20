import { createApp } from "./app.js";
import { createGatewayContext } from "./context.js";

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
  seed: {
    woocommerceUrl: env.WOOCOMMERCE_MCP_URL,
    woocommerceToken: env.WOOCOMMERCE_MCP_TOKEN,
    adminEmail: env.BOOTSTRAP_ADMIN_EMAIL,
    adminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
  },
});

context.upstreams.startStatusRefresh(env.STATUS_REFRESH_MS);

const app = createApp(context);

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "Gateway started");
});

registerGracefulShutdown(server, logger);
