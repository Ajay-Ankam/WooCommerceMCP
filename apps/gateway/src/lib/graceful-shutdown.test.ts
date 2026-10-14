import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Server } from "node:http";

import pino from "pino";

import { registerGracefulShutdown } from "./graceful-shutdown.js";

test("SIGTERM closes the HTTP server gracefully", async () => {
  const signals = new EventEmitter();
  const exitCodes: number[] = [];

  let closeCallback: ((error?: Error) => void) | undefined;

  const server = {
    close(callback: (error?: Error) => void) {
      closeCallback = callback;
      return this;
    },
    closeAllConnections() {},
  } as unknown as Server;

  registerGracefulShutdown(server, pino({ level: "silent" }), {
    signalSource: signals,
    onExit: (code) => {
      exitCodes.push(code);
    },
  });

  signals.emit("SIGTERM");

  assert.ok(closeCallback);
  assert.deepEqual(exitCodes, []);

  closeCallback();

  assert.deepEqual(exitCodes, [0]);
});

test("duplicate shutdown signals do not close the server twice", () => {
  const signals = new EventEmitter();
  let closeCalls = 0;

  const server = {
    close(callback: (error?: Error) => void) {
      closeCalls++;
      callback();
      return this;
    },
    closeAllConnections() {},
  } as unknown as Server;

  registerGracefulShutdown(server, pino({ level: "silent" }), {
    signalSource: signals,
    onExit: () => {},
  });

  signals.emit("SIGTERM");
  signals.emit("SIGINT");

  assert.equal(closeCalls, 1);
});

test("server shutdown errors produce a nonzero exit code", () => {
  const signals = new EventEmitter();
  const exitCodes: number[] = [];

  const server = {
    close(callback: (error?: Error) => void) {
      callback(new Error("Server close failed"));
      return this;
    },
    closeAllConnections() {},
  } as unknown as Server;

  registerGracefulShutdown(server, pino({ level: "silent" }), {
    signalSource: signals,
    onExit: (code) => {
      exitCodes.push(code);
    },
  });

  signals.emit("SIGTERM");

  assert.deepEqual(exitCodes, [1]);
});


test("shutdown timeout reports failure only once", async () => {
  const signals = new EventEmitter();
  const exitCodes: number[] = [];

  let closeCallback: ((error?: Error) => void) | undefined;

  let forceCloseCalls = 0;

  const server = {
    close(callback: (error?: Error) => void) {
      closeCallback = callback;
      return this;
    },

    closeAllConnections() {
      forceCloseCalls++;
    },
  } as unknown as Server;

  registerGracefulShutdown(server, pino({ level: "silent" }), {
    timeoutMs: 20,
    signalSource: signals,
    onExit: (code) => {
      exitCodes.push(code);
    },
  });

  signals.emit("SIGTERM");

  await new Promise((resolve) => setTimeout(resolve, 60));

  assert.deepEqual(exitCodes, [1]);
  assert.equal(forceCloseCalls, 1);

  // Simulate the server closing after the timeout.
  assert.ok(closeCallback);
  closeCallback();

  // A late successful close must not overwrite failure.
  assert.deepEqual(exitCodes, [1]);
});
