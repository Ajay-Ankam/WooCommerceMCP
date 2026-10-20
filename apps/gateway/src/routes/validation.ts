import type { z } from "zod";

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
