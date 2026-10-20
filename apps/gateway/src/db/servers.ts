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
  // Upstream tool names hidden from and rejected for members.
  adminOnlyTools: string[];
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
  adminOnlyTools?: string[];
}

// `authSecret`: undefined keeps the stored credential, null clears it. The
// credential is write-only from the API's point of view.
export type UpstreamServerPatch = Partial<Omit<NewUpstreamServer, "slug">>;

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
    adminOnlyTools: JSON.parse(String(row.admin_only_tools ?? "[]")) as string[],
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
          admin_only_tools, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    )
    .get(
      input.slug,
      input.name,
      input.url,
      input.authType,
      input.authHeaderName ?? null,
      input.authSecret ?? null,
      input.enabled === false ? 0 : 1,
      JSON.stringify(input.adminOnlyTools ?? []),
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

export function updateServer(
  db: Database,
  slug: string,
  patch: UpstreamServerPatch,
): UpstreamServer | undefined {
  const current = getServerBySlug(db, slug);

  if (!current) {
    return undefined;
  }

  const next = {
    name: patch.name ?? current.name,
    url: patch.url ?? current.url,
    authType: patch.authType ?? current.authType,
    authHeaderName:
      patch.authHeaderName === undefined ? current.authHeaderName : patch.authHeaderName,
    authSecret: patch.authSecret === undefined ? current.authSecret : patch.authSecret,
    enabled: patch.enabled ?? current.enabled,
    adminOnlyTools: patch.adminOnlyTools ?? current.adminOnlyTools,
  };

  const row = db
    .prepare(
      `UPDATE servers SET name = ?, url = ?, auth_type = ?, auth_header_name = ?,
         auth_secret = ?, enabled = ?, admin_only_tools = ?, updated_at = ?
       WHERE slug = ? RETURNING *`,
    )
    .get(
      next.name,
      next.url,
      next.authType,
      next.authHeaderName,
      next.authSecret,
      next.enabled ? 1 : 0,
      JSON.stringify(next.adminOnlyTools),
      new Date().toISOString(),
      slug,
    );

  return toServer(row as Record<string, unknown>);
}

export function deleteServer(db: Database, slug: string): boolean {
  const result = db.prepare("DELETE FROM servers WHERE slug = ?").run(slug);

  return Number(result.changes) > 0;
}
