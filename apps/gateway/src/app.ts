import express from "express";

import type { GatewayContext } from "./context.js";
import { httpLogger } from "./lib/http-logging.js";
import { healthRouter } from "./routes/health.js";
import { createMcpEndpointRouter } from "./routes/mcp-endpoint.js";
import { createMcpRestRouter } from "./routes/mcp.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";

export function createApp(context: GatewayContext) {
  const app = express();

  // 1. Request tracing and structured HTTP logs
  app.use(httpLogger);

  // 2. Parse JSON request bodies
  app.use(express.json({ limit: "1mb" }));

  // 3. Register application routes
  app.use(healthRouter);

  // 4. Aggregated MCP endpoint for MCP clients
  app.use(createMcpEndpointRouter(context.db, context.tools));

  // 5. REST registry routes
  app.use(createMcpRestRouter(context.db, context.upstreams, context.tools));

  // 6. Handle unknown routes
  app.use(notFoundHandler);

  // 7. Handle application and unexpected errors
  app.use(errorHandler);

  return app;
}
