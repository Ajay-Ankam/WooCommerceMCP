import { z } from "zod";

import type { Database } from "../db/database.js";
import {
  createServer,
  getServerBySlug,
  SLUG_PATTERN,
  updateServer,
  type AuthType,
} from "../db/servers.js";

// MCP servers shipped with the platform (WooCommerce, Utility, Analytics) and
// declared by the deployment, not by an admin. Helm renders their non-secret
// settings as BUNDLED_SERVERS JSON; each credential arrives as its own
// environment variable from a Kubernetes Secret and is named by
// `credentialEnv`, so no secret ever appears in the JSON.
export interface BundledServer {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string | null;
  authSecret: string | null;
  adminOnlyTools: string[];
}

const entrySchema = z
  .object({
    slug: z.string().max(32).regex(SLUG_PATTERN),
    name: z.string().trim().min(1).max(100),
    url: z.url({ protocol: /^https?$/ }).max(2048),
    authType: z.enum(["none", "bearer", "header"]).default("none"),
    authHeaderName: z.string().regex(/^[A-Za-z0-9-]{1,64}$/).optional(),
    credentialEnv: z.string().regex(/^[A-Z_][A-Z0-9_]*$/).optional(),
    adminOnlyTools: z.array(z.string().min(1).max(128)).max(200).default([]),
  })
  .strict();

const listSchema = z.array(entrySchema).max(50);

// Parses BUNDLED_SERVERS and resolves credentials from the environment.
// Errors name the variable or field at fault but never include a value.
export function parseBundledServers(
  json: string | undefined,
  environment: NodeJS.ProcessEnv = process.env,
): BundledServer[] {
  if (!json?.trim()) {
    return [];
  }

  let raw: unknown;

  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("BUNDLED_SERVERS is not valid JSON");
  }

  const result = listSchema.safeParse(raw);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`BUNDLED_SERVERS is invalid: ${details}`);
  }

  const slugs = new Set<string>();

  return result.data.map((entry) => {
    if (slugs.has(entry.slug)) {
      throw new Error(`BUNDLED_SERVERS lists slug "${entry.slug}" twice`);
    }
    slugs.add(entry.slug);

    if (entry.authType === "header" && !entry.authHeaderName) {
      throw new Error(`Bundled server "${entry.slug}" uses header auth but has no authHeaderName`);
    }

    let authSecret: string | null = null;

    if (entry.authType !== "none") {
      if (!entry.credentialEnv) {
        throw new Error(`Bundled server "${entry.slug}" needs credentialEnv for ${entry.authType} auth`);
      }

      // Trimmed like dashboard input: whitespace is never part of a token.
      authSecret = environment[entry.credentialEnv]?.trim() || null;

      if (!authSecret) {
        throw new Error(
          `Bundled server "${entry.slug}": environment variable ${entry.credentialEnv} is missing or empty`,
        );
      }
    }

    return {
      slug: entry.slug,
      name: entry.name,
      url: entry.url,
      authType: entry.authType,
      authHeaderName: entry.authType === "header" ? entry.authHeaderName! : null,
      authSecret,
      adminOnlyTools: entry.adminOnlyTools,
    };
  });
}

export interface ReconcileResult {
  created: string[];
  updated: string[];
  unchanged: string[];
}

// Runs on every start. The deployment owns how to reach a bundled server (URL
// and credential), so those follow the configuration, e.g. after a Secret is
// rotated. Admins own everything else: display name, enabled state and
// admin-only tools are set only when the server is first created. Servers
// that are not bundled are never touched.
//
// Deleting a bundled server in the dashboard is therefore undone on the next
// restart, like any declarative resource; to keep it off, disable it (that
// choice persists) or remove it from the Helm values.
export function reconcileBundledServers(
  db: Database,
  bundled: BundledServer[],
): ReconcileResult {
  const result: ReconcileResult = { created: [], updated: [], unchanged: [] };

  for (const server of bundled) {
    const current = getServerBySlug(db, server.slug);

    if (!current) {
      createServer(db, server);
      result.created.push(server.slug);
      continue;
    }

    const drifted =
      current.url !== server.url ||
      current.authType !== server.authType ||
      current.authHeaderName !== server.authHeaderName ||
      current.authSecret !== server.authSecret;

    if (!drifted) {
      result.unchanged.push(server.slug);
      continue;
    }

    updateServer(db, server.slug, {
      url: server.url,
      authType: server.authType,
      authHeaderName: server.authHeaderName,
      authSecret: server.authSecret,
    });
    result.updated.push(server.slug);
  }

  return result;
}
