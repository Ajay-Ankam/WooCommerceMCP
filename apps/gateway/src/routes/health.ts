import { Router } from "express";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "urumi-mcp-gateway",
    timestamp: new Date().toISOString(),
  });
});

healthRouter.get("/ready", (_req, res) => {
  res.status(200).json({
    status: "ready",
    service: "urumi-mcp-gateway",
    timestamp: new Date().toISOString(),
  });
});
