import test from "node:test";
import assert from "node:assert/strict";
import { parseEnv } from "./env.js";

test("uses defaults when optional variables are missing", () => {
  const config = parseEnv({});

  assert.equal(config.NODE_ENV, "development");
  assert.equal(config.PORT, 3001);
  assert.equal(config.LOG_LEVEL, "info");
});

test("accepts valid environment values", () => {
  const config = parseEnv({
    NODE_ENV: "production",
    PORT: "8080",
    LOG_LEVEL: "warn",
  });

  assert.equal(config.NODE_ENV, "production");
  assert.equal(config.PORT, 8080);
  assert.equal(config.LOG_LEVEL, "warn");
});

test("rejects a port outside the valid range", () => {
  assert.throws(
    () => parseEnv({ PORT: "70000" }),
    /Invalid gateway environment configuration/,
  );
});

test("rejects an unsupported log level", () => {
  assert.throws(
    () => parseEnv({ LOG_LEVEL: "verbose" }),
    /Invalid gateway environment configuration/,
  );
});
