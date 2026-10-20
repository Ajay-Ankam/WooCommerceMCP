import { Router } from "express";
import { z } from "zod";

import { MIN_PASSWORD_LENGTH } from "../auth/passwords.js";
import type { GatewayContext } from "../context.js";
import { createSession, deleteSession } from "../db/sessions.js";
import { acceptInvite, verifyCredentials } from "../db/users.js";
import { AppError } from "../lib/app-error.js";
import {
  clearSessionCookie,
  requireJsonForMutations,
  requireSession,
  setSessionCookie,
} from "../middleware/session-auth.js";
import { parseBody } from "./validation.js";

const loginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200),
});

const acceptInviteSchema = z.object({
  token: z.string().min(20).max(100),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

// Minimal brute-force brake: 10 failed logins per IP per 15 minutes.
const FAILURE_WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

export function createAuthRouter({ db, auth }: GatewayContext) {
  const router = Router();
  const failures = new Map<string, { count: number; resetAt: number }>();

  router.use("/api/auth", requireJsonForMutations);

  router.post("/api/auth/login", (req, res) => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = failures.get(ip);

    if (entry && entry.resetAt > now && entry.count >= MAX_FAILURES) {
      throw new AppError(429, "TOO_MANY_ATTEMPTS", "Too many failed logins; try again later");
    }

    const { email, password } = parseBody(loginSchema, req.body);
    const user = verifyCredentials(db, email, password);

    if (!user) {
      const current = entry && entry.resetAt > now ? entry : { count: 0, resetAt: now + FAILURE_WINDOW_MS };
      current.count += 1;
      failures.set(ip, current);

      throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    failures.delete(ip);
    setSessionCookie(res, createSession(db, user.id, auth.sessionTtlHours), auth);
    res.status(200).json({ user });
  });

  router.post("/api/auth/invite/accept", (req, res) => {
    const { token, password } = parseBody(acceptInviteSchema, req.body);
    const user = acceptInvite(db, token, password);

    if (!user) {
      throw new AppError(400, "INVALID_INVITE", "This invite link is invalid or has expired");
    }

    setSessionCookie(res, createSession(db, user.id, auth.sessionTtlHours), auth);
    res.status(200).json({ user });
  });

  router.post("/api/auth/logout", requireSession(db), (_req, res) => {
    deleteSession(db, res.locals.sessionToken as string);
    clearSessionCookie(res, auth);
    res.status(204).end();
  });

  return router;
}
