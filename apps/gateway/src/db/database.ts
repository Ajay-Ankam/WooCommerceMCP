import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Database = DatabaseSync;

// Single-replica gateway state. Schema is idempotent so startup can always
// run it; there is no separate migration tool to deploy.
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin', 'member')),
  password_hash TEXT,
  -- Pending invite: hash of a one-time token the member exchanges for a password.
  invite_token_hash TEXT,
  invite_expires_at TEXT,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  created_at    TEXT NOT NULL,
  last_used_at  TEXT,
  revoked_at    TEXT
);

CREATE TABLE IF NOT EXISTS servers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  url               TEXT NOT NULL,
  auth_type         TEXT NOT NULL CHECK (auth_type IN ('none', 'bearer', 'header')),
  auth_header_name  TEXT,
  auth_secret       TEXT,
  enabled           INTEGER NOT NULL DEFAULT 1,
  -- JSON array of upstream tool names only admins may list or call.
  admin_only_tools  TEXT NOT NULL DEFAULT '[]',
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_email    TEXT,
  source        TEXT NOT NULL,
  server_slug   TEXT,
  tool          TEXT NOT NULL,
  started_at    TEXT NOT NULL,
  duration_ms   INTEGER NOT NULL,
  outcome       TEXT NOT NULL CHECK (outcome IN ('success', 'error', 'denied')),
  error         TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_started_at ON audit_log (started_at DESC);
`;

// Columns added after the first release. CREATE TABLE IF NOT EXISTS does not
// alter existing tables, so older database files are upgraded here.
const addedColumns: Array<[table: string, column: string, ddl: string]> = [
  ["users", "invite_token_hash", "TEXT"],
  ["users", "invite_expires_at", "TEXT"],
  ["servers", "admin_only_tools", "TEXT NOT NULL DEFAULT '[]'"],
];

function migrate(db: DatabaseSync): void {
  for (const [table, column, ddl] of addedColumns) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;

    if (!columns.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  }

  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_invite_token ON users (invite_token_hash)",
  );
}

export function openDatabase(path: string): Database {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new DatabaseSync(path);

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(schema);
  migrate(db);

  return db;
}
