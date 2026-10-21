import { z } from "zod";

import type { AuditFilter } from "../db/audit.js";
import { AppError } from "../lib/app-error.js";

// Validates a request body and reports the first problem in plain words.
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const parsed = schema.safeParse(body ?? {});

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.join(".") || "body";

    throw new AppError(400, "INVALID_REQUEST", `${field}: ${issue.message}`);
  }

  return parsed.data;
}

export function parseId(value: unknown): number {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    throw new AppError(400, "INVALID_ID", "Invalid id");
  }

  return id;
}

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  beforeId: z.coerce.number().int().positive().optional(),
  userId: z.coerce.number().int().positive().optional(),
  server: z.string().max(32).optional(),
  outcome: z.enum(["success", "error", "denied"]).optional(),
  source: z.enum(["mcp", "rest", "chat"]).optional(),
});

// Audit list query string (?limit&beforeId&userId&server&outcome&source).
export function parseAuditQuery(query: unknown): AuditFilter {
  const parsed = auditQuerySchema.safeParse(query);

  if (!parsed.success) {
    throw new AppError(400, "INVALID_REQUEST", "Invalid audit filter");
  }

  const { server, ...filter } = parsed.data;
  return { ...filter, serverSlug: server };
}
