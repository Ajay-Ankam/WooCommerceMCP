import assert from "node:assert/strict";
import test from "node:test";

import { openDatabase } from "./database.js";
import {
  createUser,
  hashApiKey,
  issueApiKey,
  lookupApiKey,
  revokeApiKey,
} from "./users.js";

test("stores only the hash of an issued API key", () => {
  const db = openDatabase(":memory:");
  const user = createUser(db, { email: "a@test.dev", name: "A", role: "admin" });
  const { key } = issueApiKey(db, user.id, "laptop");

  const stored = db.prepare("SELECT key_hash, key_prefix FROM api_keys").get() as {
    key_hash: string;
    key_prefix: string;
  };

  assert.match(key, /^ajay_/);
  assert.equal(stored.key_hash, hashApiKey(key));
  assert.notEqual(stored.key_hash, key);
  assert.ok(key.startsWith(stored.key_prefix));
  assert.ok(stored.key_prefix.length < 16);
});

test("resolves a valid key to its user and rejects a revoked one", () => {
  const db = openDatabase(":memory:");
  const user = createUser(db, { email: "b@test.dev", name: "B", role: "member" });
  const { key, summary } = issueApiKey(db, user.id, "cli");

  const valid = lookupApiKey(db, key);
  assert.equal(valid.status, "valid");
  assert.equal(valid.status === "valid" && valid.user.email, "b@test.dev");

  assert.equal(revokeApiKey(db, summary.id), true);
  assert.equal(revokeApiKey(db, summary.id), false);
  assert.equal(lookupApiKey(db, key).status, "revoked");
  assert.equal(lookupApiKey(db, "ajay_unknown").status, "unknown");
});
