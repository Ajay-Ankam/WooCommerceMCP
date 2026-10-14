import { app } from "./app.js";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { registerGracefulShutdown } from "./lib/graceful-shutdown.js";

const server = app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "Gateway started");
});

registerGracefulShutdown(server, logger);
