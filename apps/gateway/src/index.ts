import express from "express";
import { env } from "./config/env.js";

const app = express();

app.use(express.json());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-mcp-gateway",
    timestamp: new Date().toISOString(),
  });
});

app.listen(env.PORT, "0.0.0.0", () => {
  console.log(`Gateway listening on port ${env.PORT} (${env.NODE_ENV})`);
});
