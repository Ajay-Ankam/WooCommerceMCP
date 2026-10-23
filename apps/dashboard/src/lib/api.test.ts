// Run with: npm run test --workspace=@project-ajay/dashboard (Node test runner).
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { api, ApiError, loginErrorMessage } from "./api.ts";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

function respond(status: number, body: string, contentType = "application/json") {
  globalThis.fetch = (async () => new Response(body, { status, headers: { "Content-Type": contentType } })) as typeof fetch;
}

async function loginError(): Promise<unknown> {
  try {
    await api("/api/auth/login", { method: "POST", body: { email: "a@b.dev", password: "x" } });
  } catch (error) {
    return error;
  }

  assert.fail("expected the request to fail");
}

test("ingress 503 without a gateway body is reported as temporarily unavailable", async () => {
  respond(503, "no available server", "text/plain");
  const error = await loginError();

  assert.ok(error instanceof ApiError);
  assert.equal(error.status, 503);
  assert.equal(error.code, "HTTP_503");
  assert.equal(error.message, "The gateway is temporarily unavailable. Please try again in a moment.");
  assert.equal(loginErrorMessage(error), "The gateway is temporarily unavailable. Please try again in a moment.");
});

test("ingress 502 is also temporarily unavailable, never a raw status", async () => {
  respond(502, "Bad Gateway", "text/plain");
  const message = loginErrorMessage(await loginError());

  assert.doesNotMatch(message, /Request failed/);
  assert.match(message, /temporarily unavailable/);
});

test("gateway 401 and 429 keep their specific meaning", async () => {
  respond(401, JSON.stringify({ error: { code: "INVALID_CREDENTIALS", message: "Invalid email or password" } }));
  assert.equal(loginErrorMessage(await loginError()), "Invalid email or password.");

  respond(429, JSON.stringify({ error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed logins; try again later" } }));
  assert.match(loginErrorMessage(await loginError()), /Too many failed sign-in attempts/);
});

test("a gateway 503 with its own error body keeps the gateway message", async () => {
  respond(503, JSON.stringify({ error: { code: "LLM_UNAVAILABLE", message: "All LLM providers failed" } }));
  const error = await loginError();

  assert.ok(error instanceof ApiError);
  assert.equal(error.message, "All LLM providers failed");
});

test("network failures and unexpected errors are distinguished", async () => {
  globalThis.fetch = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.match(loginErrorMessage(await loginError()), /Cannot reach the gateway/);

  respond(500, "", "text/plain");
  assert.equal(loginErrorMessage(await loginError()), "Sign-in failed unexpectedly. Please try again.");
  assert.equal(loginErrorMessage(new Error("boom")), "Sign-in failed unexpectedly. Please try again.");
});
