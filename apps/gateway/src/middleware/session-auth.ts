import type { RequestHandler, Response } from "express";

import type { AuthSettings } from "../context.js";
import type { Database } from "../db/database.js";
import { findSessionUser } from "../db/sessions.js";
import type { User } from "../db/users.js";
import { AppError } from "../lib/app-error.js";

export const SESSION_COOKIE = "ajay_session";

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");

    if (index > 0 && part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }

  return undefined;
}

export function setSessionCookie(res: Response, token: string, auth: AuthSettings): void {
  res.cookie(SESSION_COOKIE, token, {
    // Not readable by page scripts, never sent cross-site.
    httpOnly: true,
    sameSite: "strict",
    secure: auth.cookieSecure,
    path: "/",
    maxAge: auth.sessionTtlHours * 3_600_000,
  });
}

export function clearSessionCookie(res: Response, auth: AuthSettings): void {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "strict",
    secure: auth.cookieSecure,
    path: "/",
  });
}

// Dashboard requests authenticate with the session cookie. The role is read
// from the users table on every request, so a role change applies at once.
export function requireSession(db: Database): RequestHandler {
  return (req, res, next) => {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    const user = token ? findSessionUser(db, token) : undefined;

    if (!token || !user) {
      return next(new AppError(401, "NOT_LOGGED_IN", "Please log in"));
    }

    res.locals.user = user;
    res.locals.sessionToken = token;
    next();
  };
}

export const requireAdmin: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as User | undefined;

  if (user?.role !== "admin") {
    return next(new AppError(403, "ADMIN_REQUIRED", "This action requires the admin role"));
  }

  next();
};

// CSRF defence in depth alongside SameSite=Strict: cross-site HTML forms
// cannot send application/json without a CORS preflight, which we never allow.
export const requireJsonForMutations: RequestHandler = (req, _res, next) => {
  // Checks the header itself: req.is() returns null for body-less DELETEs.
  const contentType = req.headers["content-type"] ?? "";

  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || contentType.startsWith("application/json")) {
    return next();
  }

  next(new AppError(415, "JSON_REQUIRED", "Requests must use Content-Type: application/json"));
};
