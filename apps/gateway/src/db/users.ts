import { createHash, randomBytes } from "node:crypto";

import {
  hashPassword,
  randomToken,
  sha256,
  verifyPassword,
} from "../auth/passwords.js";

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

// ---------------------------------------------------------------------------
// Dashboard accounts: passwords, invites and administration.

export interface UserDetails extends User {
  createdAt: string;
  hasPassword: boolean;
  invitePending: boolean;
  keys: ApiKeySummary[];
}

function toKeySummary(row: Record<string, unknown>): ApiKeySummary {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    name: String(row.name),
    prefix: String(row.key_prefix),
    createdAt: String(row.created_at),
    lastUsedAt: (row.last_used_at as string | null) ?? null,
    revokedAt: (row.revoked_at as string | null) ?? null,
  };
}

export function getUserById(db: Database, id: number): User | undefined {
  const row = db
    .prepare("SELECT id, email, name, role FROM users WHERE id = ?")
    .get(id);

  return row ? toUser(row as Record<string, unknown>) : undefined;
}

export function listApiKeys(db: Database, userId?: number): ApiKeySummary[] {
  const rows =
    userId === undefined
      ? db.prepare("SELECT * FROM api_keys ORDER BY id").all()
      : db.prepare("SELECT * FROM api_keys WHERE user_id = ? ORDER BY id").all(userId);

  return rows.map((row) => toKeySummary(row as Record<string, unknown>));
}

export function getApiKey(db: Database, keyId: number): ApiKeySummary | undefined {
  const row = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(keyId);

  return row ? toKeySummary(row as Record<string, unknown>) : undefined;
}

export function listUsers(db: Database): UserDetails[] {
  const keys = listApiKeys(db);

  return db
    .prepare("SELECT * FROM users ORDER BY id")
    .all()
    .map((row) => {
      const r = row as Record<string, unknown>;
      const user = toUser(r);

      return {
        ...user,
        createdAt: String(r.created_at),
        hasPassword: Boolean(r.password_hash),
        invitePending: Boolean(r.invite_token_hash),
        keys: keys.filter((key) => key.userId === user.id),
      };
    });
}

export function countAdmins(db: Database): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'")
    .get() as { n: number };

  return Number(row.n);
}

export function updateUserRole(db: Database, userId: number, role: Role): boolean {
  const result = db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);

  return Number(result.changes) > 0;
}

// Cascades to the user's API keys and sessions; audit rows keep the email.
export function deleteUser(db: Database, userId: number): boolean {
  const result = db.prepare("DELETE FROM users WHERE id = ?").run(userId);

  return Number(result.changes) > 0;
}

export function setPassword(db: Database, userId: number, password: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(password),
    userId,
  );
}

// Verifying against a dummy hash equalises timing between unknown emails and
// wrong passwords. Created lazily so importing this module stays cheap.
let dummyHash: string | undefined;

export function verifyCredentials(
  db: Database,
  email: string,
  password: string,
): User | undefined {
  const row = db
    .prepare("SELECT id, email, name, role, password_hash FROM users WHERE email = ?")
    .get(email) as Record<string, unknown> | undefined;

  const stored =
    (row?.password_hash as string | null | undefined) ??
    (dummyHash ??= hashPassword(randomToken()));
  const valid = verifyPassword(password, stored);

  return row && row.password_hash && valid ? toUser(row) : undefined;
}

// Returns the one-time invite token; only its hash is stored.
export function createInvite(db: Database, userId: number, ttlHours: number): string {
  const token = randomToken();
  const expires = new Date(Date.now() + ttlHours * 3_600_000).toISOString();

  db.prepare(
    "UPDATE users SET invite_token_hash = ?, invite_expires_at = ? WHERE id = ?",
  ).run(sha256(token), expires, userId);

  return token;
}

export function acceptInvite(
  db: Database,
  token: string,
  password: string,
): User | undefined {
  const row = db
    .prepare(
      "SELECT id, email, name, role, invite_expires_at FROM users WHERE invite_token_hash = ?",
    )
    .get(sha256(token)) as Record<string, unknown> | undefined;

  if (!row || String(row.invite_expires_at) < now()) {
    return undefined;
  }

  db.prepare(
    `UPDATE users SET password_hash = ?, invite_token_hash = NULL,
       invite_expires_at = NULL WHERE id = ?`,
  ).run(hashPassword(password), Number(row.id));

  return toUser(row);
}
