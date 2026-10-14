import test from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { PassThrough } from "node:stream";

import express from "express";
import pino from "pino";

import { createHttpLogger, httpLogger } from "./http-logging.js";

async function startTestServer(
  app: ReturnType<typeof express>,
): Promise<Server> {
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1");

    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function closeTestServer(server: Server): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

test("adds a UUID request ID and handles HTTP requests", async () => {
  const app = express();

  app.use(httpLogger);

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const server = await startTestServer(app);

  try {
    const address = server.address();

    assert.ok(address && typeof address !== "string");

    const response = await fetch(`http://127.0.0.1:${address.port}/health`);

    assert.equal(response.status, 200);

    const requestId = response.headers.get("x-request-id");

    assert.ok(requestId);

    assert.match(
      requestId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

    await response.text();
  } finally {
    await closeTestServer(server);
  }
});

test("does not expose query parameters or authorization headers in logs", async () => {
  const output = new PassThrough();
  let logs = "";

  output.on("data", (chunk: Buffer) => {
    logs += chunk.toString("utf8");
  });

  const testLogger = pino(
    {
      level: "info",
      redact: {
        paths: ["req.headers.authorization", "req.headers.cookie"],
        censor: "[REDACTED]",
      },
    },
    output,
  );

  const app = express();

  app.use(createHttpLogger(testLogger));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok" });
  });

  const server = await startTestServer(app);

  try {
    const address = server.address();

    assert.ok(address && typeof address !== "string");

    const response = await fetch(
      `http://127.0.0.1:${address.port}/health?token=secret123`,
      {
        headers: {
          Authorization: "Bearer private-token",
        },
      },
    );

    assert.equal(response.status, 200);

    await response.text();

    assert.ok(
      logs.includes('"path":"/health"'),
      "Log should contain the sanitized request path",
    );

    assert.ok(
      logs.includes('"statusCode":200'),
      "Log should contain the HTTP status code",
    );

    assert.ok(
      !logs.includes("secret123"),
      "Log must not contain query parameter secrets",
    );

    assert.ok(
      !logs.includes("private-token"),
      "Log must not contain authorization credentials",
    );
  } finally {
    await closeTestServer(server);
    output.end();
  }
});
