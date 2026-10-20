import type { Database } from "./database.js";

export type AuthType = "none" | "bearer" | "header";

// Server-side only: includes the upstream credential.
export interface UpstreamServer {
  id: number;
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string | null;
  authSecret: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

// Safe to send to browsers and MCP clients: the credential is never included.
export type PublicUpstreamServer = Omit<UpstreamServer, "authSecret"> & {
  hasCredential: boolean;
};

export interface NewUpstreamServer {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName?: string | null;
  authSecret?: string | null;
  enabled?: boolean;
}

// Lowercase letters, digits and single hyphens. Excluding "_" guarantees the
// "<slug>__<tool>" namespace separator is unambiguous.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function toServer(row: Record<string, unknown>): UpstreamServer {
  return {
    id: Number(row.id),
    slug: String(row.slug),
    name: String(row.name),
    url: String(row.url),
    authType: row.auth_type as AuthType,
    authHeaderName: (row.auth_header_name as string | null) ?? null,
    authSecret: (row.auth_secret as string | null) ?? null,
    enabled: Number(row.enabled) === 1,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function toPublicServer(server: UpstreamServer): PublicUpstreamServer {
  const { authSecret, ...rest } = server;

  return { ...rest, hasCredential: Boolean(authSecret) };
}

export function listServers(db: Database): UpstreamServer[] {
  return db
    .prepare("SELECT * FROM servers ORDER BY id")
    .all()
    .map((row) => toServer(row as Record<string, unknown>));
}

export function getServerBySlug(
  db: Database,
  slug: string,
): UpstreamServer | undefined {
  const row = db.prepare("SELECT * FROM servers WHERE slug = ?").get(slug);

  return row ? toServer(row as Record<string, unknown>) : undefined;
}

export function createServer(
  db: Database,
  input: NewUpstreamServer,
): UpstreamServer {
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new Error(`Invalid server slug: ${input.slug}`);
  }

  const timestamp = new Date().toISOString();

  const row = db
    .prepare(
      `INSERT INTO servers
         (slug, name, url, auth_type, auth_header_name, auth_secret, enabled,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.slug,
      input.name,
      input.url,
      input.authType,
      input.authHeaderName ?? null,
      input.authSecret ?? null,
      input.enabled === false ? 0 : 1,
      timestamp,
      timestamp,
    );

  return toServer(row as Record<string, unknown>);
}

export function setServerEnabled(
  db: Database,
  slug: string,
  enabled: boolean,
): boolean {
  const result = db
    .prepare("UPDATE servers SET enabled = ?, updated_at = ? WHERE slug = ?")
    .run(enabled ? 1 : 0, new Date().toISOString(), slug);

  return Number(result.changes) > 0;
}
