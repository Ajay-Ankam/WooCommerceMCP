import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

import express from "express";

import { createApp } from "./app.js";
import { createTestContext } from "./test-support.js";
import { httpLogger } from "./lib/http-logging.js";
import { errorHandler } from "./middleware/error-handler.js";

async function startServer(app: ReturnType<typeof express>): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");

    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function stopServer(server: Server): Promise<void> {
  if (!server.listening) return;

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

test("GET /health returns HTTP 200", async () => {
  const server = await startServer(createApp(createTestContext()));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
    assert.equal(body.service, "urumi-mcp-gateway");
    assert.ok(body.timestamp);
  } finally {
    await stopServer(server);
  }
});

test("GET /ready returns HTTP 200", async () => {
  const server = await startServer(createApp(createTestContext()));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/ready`);

    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.service, "urumi-mcp-gateway");
  } finally {
    await stopServer(server);
  }
});

test("unknown routes return structured HTTP 404 errors", async () => {
  const server = await startServer(createApp(createTestContext()));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/unknown`,
    );

    const body = await response.json();

    assert.equal(response.status, 404);
    assert.equal(body.error.code, "ROUTE_NOT_FOUND");
    assert.match(body.error.requestId, /^[0-9a-f-]{36}$/);
  } finally {
    await stopServer(server);
  }
});

test("unexpected exceptions return safe HTTP 500 errors", async () => {
  const app = express();

  app.use(httpLogger);

  app.get("/test-error", () => {
    throw new Error("Sensitive internal database information");
  });

  app.use(errorHandler);

  const server = await startServer(app);

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/test-error`);

    const body = await response.json();

    assert.equal(response.status, 500);
    assert.equal(body.error.code, "INTERNAL_SERVER_ERROR");
    assert.equal(body.error.message, "An unexpected error occurred");

    assert.ok(
      !JSON.stringify(body).includes("Sensitive internal database information"),
    );
  } finally {
    await stopServer(server);
  }
});

test("error response request ID matches X-Request-ID header", async () => {
  const server = await startServer(createApp(createTestContext()));

  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/missing`);

    const body = await response.json();

    const headerId = response.headers.get("x-request-id");

    assert.equal(response.status, 404);
    assert.ok(headerId);
    assert.equal(body.error.requestId, headerId);
  } finally {
    await stopServer(server);
  }
});
