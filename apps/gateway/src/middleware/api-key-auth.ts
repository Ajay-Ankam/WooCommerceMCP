import type { RequestHandler, Response } from "express";

import { writeAudit, type AuditSource } from "../db/audit.js";
import type { Database } from "../db/database.js";
import { lookupApiKey, type User } from "../db/users.js";
import { AppError } from "../lib/app-error.js";

export function getAuthenticatedUser(res: Response): User {
  const user = res.locals.user as User | undefined;

  if (!user) {
    throw new AppError(401, "UNAUTHORIZED", "A valid Gateway API key is required");
  }

  return user;
}

// Best-effort name of what a rejected caller attempted, for the audit log.
function attemptedAction(body: unknown, fallback: string): string {
  const b = body as
    | { method?: unknown; params?: { name?: unknown }; tool?: unknown }
    | undefined;

  for (const candidate of [b?.params?.name, b?.tool, b?.method]) {
    if (typeof candidate === "string" && candidate) {
      return candidate;
    }
  }

  return fallback;
}

// Resolves "Authorization: Bearer <key>" to a user. Keys are looked up by
// their SHA-256 hash; the plaintext key is never stored or logged.
export function requireApiKey(db: Database, source: AuditSource): RequestHandler {
  return (req, res, next) => {
    const match = /^Bearer (.+)$/i.exec(req.headers.authorization ?? "");

    if (!match) {
      return next(
        new AppError(401, "UNAUTHORIZED", "A valid Gateway API key is required"),
      );
    }

    const result = lookupApiKey(db, match[1].trim());

    if (result.status === "revoked") {
      // A revoked key still identifies its owner, so the rejection is
      // attributed to them in the audit log.
      writeAudit(db, {
        userId: result.user.id,
        userEmail: result.user.email,
        source,
        serverSlug: null,
        tool: attemptedAction(req.body, `${req.method} ${req.path}`),
        startedAt: new Date().toISOString(),
        durationMs: 0,
        outcome: "denied",
        error: "API key revoked",
      });

      return next(new AppError(401, "API_KEY_REVOKED", "This API key has been revoked"));
    }

    if (result.status !== "valid") {
      return next(
        new AppError(401, "UNAUTHORIZED", "A valid Gateway API key is required"),
      );
    }

    res.locals.user = result.user;
    next();
  };
}
