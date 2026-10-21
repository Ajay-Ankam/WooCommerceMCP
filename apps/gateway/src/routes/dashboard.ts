import { existsSync } from "node:fs";
import path from "node:path";

import express, { Router, type Response } from "express";

// Paths the gateway answers itself; the SPA fallback never shadows them.
const BACKEND_PATH = /^\/(api|mcp|health|ready)(\/|$)/;

// The built bundle has no inline scripts and only talks to this origin.
// Inline styles stay allowed for component libraries that set style attributes.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

function setPageHeaders(res: Response) {
  // index.html must always be revalidated so a new deploy is picked up.
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
}

// Serves the built React dashboard from the same origin as the API, so the
// session cookie works without CORS. Client-side routes (e.g. /invite/<token>)
// fall back to index.html.
export function createDashboardRouter(dashboardDir: string) {
  const root = path.resolve(dashboardDir);
  const indexFile = path.join(root, "index.html");

  if (!existsSync(indexFile)) {
    throw new Error(`DASHBOARD_DIR has no index.html: ${root}`);
  }

  const router = Router();

  router.use(
    express.static(root, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints everything under assets/, so it can be cached forever.
        if (filePath.startsWith(path.join(root, "assets") + path.sep)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  router.use((req, res, next) => {
    if ((req.method !== "GET" && req.method !== "HEAD") || BACKEND_PATH.test(req.path)) {
      return next();
    }

    setPageHeaders(res);
    res.sendFile(indexFile);
  });

  return router;
}
