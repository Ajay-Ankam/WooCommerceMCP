import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  PORT: z.coerce.number().int().min(1).max(65535).default(3001),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export function parseEnv(input: NodeJS.ProcessEnv = process.env) {
  const result = envSchema.safeParse(input);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid gateway environment configuration:\n${details}`);
  }

  return result.data;
}

export const env = parseEnv();
