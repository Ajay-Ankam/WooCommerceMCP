import express from "express";

import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { httpLogger } from "./lib/http-logging.js";

const app = express();

app.use(httpLogger);
app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-mcp-gateway",
    timestamp: new Date().toISOString(),
  });
});

app.listen(env.PORT, "0.0.0.0", () => {
  logger.info({ port: env.PORT }, "Gateway started");
});
