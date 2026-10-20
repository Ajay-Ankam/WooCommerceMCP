import { randomToken, sha256 } from "../auth/passwords.js";
import type { Database } from "./database.js";
import type { Role, User } from "./users.js";

// Server-side sessions: the cookie holds a random token, the database only
// its hash, so a leaked database cannot be replayed as live sessions.
export function createSession(db: Database, userId: number, ttlHours: number): string {
  const token = randomToken();
  const now = new Date();

  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString());
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(
    sha256(token),
    userId,
    now.toISOString(),
    new Date(now.getTime() + ttlHours * 3_600_000).toISOString(),
  );

  return token;
}

export function findSessionUser(db: Database, token: string): User | undefined {
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(sha256(token), new Date().toISOString()) as Record<string, unknown> | undefined;

  return row
    ? { id: Number(row.id), email: String(row.email), name: String(row.name), role: row.role as Role }
    : undefined;
}

export function deleteSession(db: Database, token: string): void {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
}

export function deleteUserSessions(db: Database, userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
