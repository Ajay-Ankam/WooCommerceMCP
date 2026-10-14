import express from "express";

import { httpLogger } from "./lib/http-logging.js";
import { healthRouter } from "./routes/health.js";

import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp() {
  const app = express();

  // 1. Request tracing and structured HTTP logs
  app.use(httpLogger);

  // 2. Parse JSON request bodies
  app.use(express.json());

  // 3. Register application routes
  app.use(healthRouter);

  // 4. Handle unknown routes
  app.use(notFoundHandler);

  // 5. Handle application and unexpected errors
  app.use(errorHandler);

  return app;
}

export const app = createApp();
