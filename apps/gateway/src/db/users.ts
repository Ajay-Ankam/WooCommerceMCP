import { createHash, randomBytes } from "node:crypto";

import type { Database } from "./database.js";

export type Role = "admin" | "member";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface ApiKeySummary {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export type ApiKeyLookup =
  | { status: "valid"; user: User; keyId: number }
  | { status: "revoked"; user: User; keyId: number }
  | { status: "unknown" };

const KEY_PREFIX = "ajay_";

// Keys carry 256 bits of randomness, so a fast SHA-256 digest is enough:
// brute-forcing the hash is infeasible, unlike low-entropy passwords.
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function generateApiKey(): string {
  return KEY_PREFIX + randomBytes(32).toString("base64url");
}

function now(): string {
  return new Date().toISOString();
}

function toUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    email: String(row.email),
    name: String(row.name),
    role: row.role as Role,
  };
}

export function createUser(
  db: Database,
  input: { email: string; name: string; role: Role },
): User {
  const row = db
    .prepare(
      `INSERT INTO users (email, name, role, created_at)
       VALUES (?, ?, ?, ?) RETURNING id, email, name, role`,
    )
    .get(input.email, input.name, input.role, now());

  return toUser(row as Record<string, unknown>);
}

export function findUserByEmail(db: Database, email: string): User | undefined {
  const row = db
    .prepare("SELECT id, email, name, role FROM users WHERE email = ?")
    .get(email);

  return row ? toUser(row as Record<string, unknown>) : undefined;
}

export function countUsers(db: Database): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM users").get() as {
    n: number;
  };

  return Number(row.n);
}

// Returns the plaintext key exactly once; only its hash is persisted.
export function issueApiKey(
  db: Database,
  userId: number,
  name: string,
): { key: string; summary: ApiKeySummary } {
  const key = generateApiKey();
  const prefix = key.slice(0, KEY_PREFIX.length + 6);

  const row = db
    .prepare(
      `INSERT INTO api_keys (user_id, name, key_prefix, key_hash, created_at)
       VALUES (?, ?, ?, ?, ?) RETURNING id, created_at`,
    )
    .get(userId, name, prefix, hashApiKey(key), now()) as {
    id: number;
    created_at: string;
  };

  return {
    key,
    summary: {
      id: Number(row.id),
      userId,
      name,
      prefix,
      createdAt: row.created_at,
      lastUsedAt: null,
      revokedAt: null,
    },
  };
}

export function revokeApiKey(db: Database, keyId: number): boolean {
  const result = db
    .prepare(
      "UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
    )
    .run(now(), keyId);

  return Number(result.changes) > 0;
}

export function lookupApiKey(db: Database, key: string): ApiKeyLookup {
  const row = db
    .prepare(
      `SELECT k.id AS key_id, k.revoked_at, u.id, u.email, u.name, u.role
       FROM api_keys k JOIN users u ON u.id = k.user_id
       WHERE k.key_hash = ?`,
    )
    .get(hashApiKey(key)) as Record<string, unknown> | undefined;

  if (!row) {
    return { status: "unknown" };
  }

  const user = toUser(row);
  const keyId = Number(row.key_id);

  if (row.revoked_at) {
    return { status: "revoked", user, keyId };
  }

  db.prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(
    now(),
    keyId,
  );

  return { status: "valid", user, keyId };
}
