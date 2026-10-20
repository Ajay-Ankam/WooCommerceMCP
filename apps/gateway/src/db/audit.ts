import type { Database } from "./database.js";

export type AuditSource = "mcp" | "rest" | "chat";
export type AuditOutcome = "success" | "error" | "denied";

export interface AuditEntry {
  userId: number | null;
  userEmail: string | null;
  source: AuditSource;
  serverSlug: string | null;
  tool: string;
  startedAt: string;
  durationMs: number;
  outcome: AuditOutcome;
  error?: string | null;
}

export interface AuditRecord extends AuditEntry {
  id: number;
}

const MAX_ERROR_LENGTH = 500;

export function writeAudit(db: Database, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log
       (user_id, user_email, source, server_slug, tool, started_at,
        duration_ms, outcome, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    entry.userId,
    entry.userEmail,
    entry.source,
    entry.serverSlug,
    entry.tool,
    entry.startedAt,
    Math.round(entry.durationMs),
    entry.outcome,
    entry.error ? entry.error.slice(0, MAX_ERROR_LENGTH) : null,
  );
}

export function listAudit(db: Database, limit = 100): AuditRecord[] {
  return db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit)
    .map((row) => {
      const r = row as Record<string, unknown>;

      return {
        id: Number(r.id),
        userId: r.user_id === null ? null : Number(r.user_id),
        userEmail: (r.user_email as string | null) ?? null,
        source: r.source as AuditSource,
        serverSlug: (r.server_slug as string | null) ?? null,
        tool: String(r.tool),
        startedAt: String(r.started_at),
        durationMs: Number(r.duration_ms),
        outcome: r.outcome as AuditOutcome,
        error: (r.error as string | null) ?? null,
      };
    });
}
