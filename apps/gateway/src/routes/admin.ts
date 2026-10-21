import { Router } from "express";
import { z } from "zod";

import type { GatewayContext } from "../context.js";
import { listAudit } from "../db/audit.js";
import {
  SLUG_PATTERN,
  createServer,
  deleteServer,
  getServerBySlug,
  listServers,
  toPublicServer,
  updateServer,
  type UpstreamServer,
} from "../db/servers.js";
import {
  countAdmins,
  createInvite,
  createUser,
  deleteUser,
  findUserByEmail,
  getApiKey,
  getUserById,
  issueApiKey,
  listUsers,
  revokeApiKey,
  updateUserRole,
} from "../db/users.js";
import { AppError } from "../lib/app-error.js";
import { namespaceTool } from "../mcp/tool-names.js";
import { getAuthenticatedUser } from "../middleware/api-key-auth.js";
import {
  requireAdmin,
  requireJsonForMutations,
  requireSession,
} from "../middleware/session-auth.js";
import { parseAuditQuery, parseBody, parseId } from "./validation.js";

// Headers the gateway controls itself; an upstream credential may not override them.
const RESERVED_HEADERS = new Set([
  "accept", "connection", "content-length", "content-type", "host",
  "mcp-protocol-version", "mcp-session-id", "transfer-encoding",
]);

const serverFields = {
  name: z.string().trim().min(1).max(100),
  url: z.url({ protocol: /^https?$/ }).max(2048),
  authType: z.enum(["none", "bearer", "header"]),
  authHeaderName: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .refine((h) => !RESERVED_HEADERS.has(h.toLowerCase()), "reserved header")
    .nullable(),
  // Write-only: accepted here, never returned by any endpoint.
  authSecret: z.string().min(1).max(4096).nullable(),
  enabled: z.boolean(),
  adminOnlyTools: z.array(z.string().min(1).max(128)).max(200),
};

const createServerSchema = z
  .object({
    slug: z.string().max(32).regex(SLUG_PATTERN, "lowercase letters, digits and hyphens"),
    ...serverFields,
    authType: serverFields.authType.default("none"),
    authHeaderName: serverFields.authHeaderName.optional(),
    authSecret: serverFields.authSecret.optional(),
    enabled: serverFields.enabled.optional(),
    adminOnlyTools: serverFields.adminOnlyTools.optional(),
  })
  .strict();

const updateServerSchema = z.object(serverFields).partial().strict();

function checkCredential(server: Pick<UpstreamServer, "authType" | "authHeaderName" | "authSecret">) {
  if (server.authType !== "none" && !server.authSecret) {
    throw new AppError(400, "INVALID_REQUEST", "authSecret is required for bearer or header auth");
  }

  if (server.authType === "header" && !server.authHeaderName) {
    throw new AppError(400, "INVALID_REQUEST", "authHeaderName is required for header auth");
  }
}

const inviteSchema = z
  .object({
    email: z.email().max(254),
    name: z.string().trim().min(1).max(100),
    role: z.enum(["admin", "member"]).default("member"),
  })
  .strict();

const roleSchema = z.object({ role: z.enum(["admin", "member"]) }).strict();
const keySchema = z.object({ name: z.string().trim().min(1).max(60) }).strict();

export function createAdminRouter({ db, upstreams, auth }: GatewayContext) {
  const router = Router();

  router.use("/api/admin", requireSession(db), requireAdmin, requireJsonForMutations);

  function findServer(slug: unknown): UpstreamServer {
    const server = getServerBySlug(db, String(slug));

    if (!server) {
      throw new AppError(404, "MCP_SERVER_NOT_FOUND", "MCP server not found");
    }

    return server;
  }

  // Status comes from the background probe; tools from the last successful one.
  function describeServer(server: UpstreamServer) {
    const state = upstreams.getState(server);

    return {
      ...toPublicServer(server),
      status: state.status,
      statusError: state.error,
      checkedAt: state.checkedAt,
      tools: state.tools.map((tool) => ({
        name: tool.name,
        exposedName: namespaceTool(server.slug, tool.name),
        description: tool.description ?? "",
        inputSchema: tool.inputSchema,
        adminOnly: server.adminOnlyTools.includes(tool.name),
      })),
    };
  }

  // ---- Servers -------------------------------------------------------------

  router.get("/api/admin/servers", (_req, res) => {
    res.status(200).json({ servers: listServers(db).map(describeServer) });
  });

  router.post("/api/admin/servers", async (req, res) => {
    const input = parseBody(createServerSchema, req.body);

    if (getServerBySlug(db, input.slug)) {
      throw new AppError(409, "MCP_SERVER_EXISTS", `A server with slug "${input.slug}" already exists`);
    }

    checkCredential({
      authType: input.authType,
      authHeaderName: input.authHeaderName ?? null,
      authSecret: input.authSecret ?? null,
    });

    const server = createServer(db, input);
    await upstreams.refresh(server);
    res.status(201).json({ server: describeServer(server) });
  });

  router.patch("/api/admin/servers/:slug", async (req, res) => {
    const current = findServer(req.params.slug);
    const patch = parseBody(updateServerSchema, req.body);

    checkCredential({
      authType: patch.authType ?? current.authType,
      authHeaderName: patch.authHeaderName === undefined ? current.authHeaderName : patch.authHeaderName,
      authSecret: patch.authSecret === undefined ? current.authSecret : patch.authSecret,
    });

    const server = updateServer(db, current.slug, patch)!;
    await upstreams.refresh(server);
    res.status(200).json({ server: describeServer(server) });
  });

  router.delete("/api/admin/servers/:slug", async (req, res) => {
    const server = findServer(req.params.slug);

    deleteServer(db, server.slug);
    await upstreams.forget(server.slug);
    res.status(204).end();
  });

  // ---- Members and keys ----------------------------------------------------

  router.get("/api/admin/users", (_req, res) => {
    res.status(200).json({ users: listUsers(db) });
  });

  // Returns a one-time invite token; the member sets their own password with it.
  router.post("/api/admin/users", (req, res) => {
    const input = parseBody(inviteSchema, req.body);

    if (findUserByEmail(db, input.email)) {
      throw new AppError(409, "USER_EXISTS", "A user with this email already exists");
    }

    const user = createUser(db, input);
    const token = createInvite(db, user.id, auth.inviteTtlHours);

    res.status(201).json({
      user,
      inviteToken: token,
      invitePath: `/invite/${token}`,
      expiresInHours: auth.inviteTtlHours,
    });
  });

  // Re-issue an invite, e.g. when the link expired or the member forgot it.
  router.post("/api/admin/users/:id/invite", (req, res) => {
    const user = getUserById(db, parseId(req.params.id));

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    const token = createInvite(db, user.id, auth.inviteTtlHours);
    res.status(200).json({ user, inviteToken: token, invitePath: `/invite/${token}`, expiresInHours: auth.inviteTtlHours });
  });

  router.patch("/api/admin/users/:id", (req, res) => {
    const user = getUserById(db, parseId(req.params.id));
    const { role } = parseBody(roleSchema, req.body);

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    if (user.role === "admin" && role === "member" && countAdmins(db) === 1) {
      throw new AppError(409, "LAST_ADMIN", "The team must keep at least one admin");
    }

    updateUserRole(db, user.id, role);
    res.status(200).json({ user: getUserById(db, user.id) });
  });

  router.delete("/api/admin/users/:id", (req, res) => {
    const user = getUserById(db, parseId(req.params.id));

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    if (user.id === getAuthenticatedUser(res).id) {
      throw new AppError(409, "CANNOT_REMOVE_SELF", "You cannot remove your own account");
    }

    // Removes the user's keys and sessions too; audit rows keep their email.
    deleteUser(db, user.id);
    res.status(204).end();
  });

  router.post("/api/admin/users/:id/keys", (req, res) => {
    const user = getUserById(db, parseId(req.params.id));
    const { name } = parseBody(keySchema, req.body);

    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "User not found");
    }

    const { key, summary } = issueApiKey(db, user.id, name);
    res.status(201).json({ key, summary });
  });

  router.delete("/api/admin/keys/:id", (req, res) => {
    const key = getApiKey(db, parseId(req.params.id));

    if (!key) {
      throw new AppError(404, "KEY_NOT_FOUND", "API key not found");
    }

    revokeApiKey(db, key.id);
    res.status(200).json({ key: getApiKey(db, key.id) });
  });

  // ---- Audit ---------------------------------------------------------------

  router.get("/api/admin/audit", (req, res) => {
    res.status(200).json({ entries: listAudit(db, parseAuditQuery(req.query)) });
  });

  return router;
}
