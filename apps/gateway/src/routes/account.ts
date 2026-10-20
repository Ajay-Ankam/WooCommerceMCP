import { Router } from "express";
import { z } from "zod";

import type { GatewayContext } from "../context.js";
import { getApiKey, issueApiKey, listApiKeys, revokeApiKey } from "../db/users.js";
import { AppError } from "../lib/app-error.js";
import { getAuthenticatedUser } from "../middleware/api-key-auth.js";
import { requireJsonForMutations, requireSession } from "../middleware/session-auth.js";
import { parseBody, parseId } from "./validation.js";

const newKeySchema = z.object({ name: z.string().trim().min(1).max(60) });

// Self-service for every logged-in user, admin or member.
export function createAccountRouter({ db, tools }: GatewayContext) {
  const router = Router();

  router.use(["/api/me", "/api/tools"], requireSession(db), requireJsonForMutations);

  router.get("/api/me", (_req, res) => {
    res.status(200).json({ user: getAuthenticatedUser(res) });
  });

  router.get("/api/me/keys", (_req, res) => {
    res.status(200).json({ keys: listApiKeys(db, getAuthenticatedUser(res).id) });
  });

  // The plaintext key is in this response only; it cannot be retrieved later.
  router.post("/api/me/keys", (req, res) => {
    const { name } = parseBody(newKeySchema, req.body);
    const { key, summary } = issueApiKey(db, getAuthenticatedUser(res).id, name);

    res.status(201).json({ key, summary });
  });

  router.delete("/api/me/keys/:id", (req, res) => {
    const key = getApiKey(db, parseId(req.params.id));

    // Someone else's key is reported as missing so ids cannot be probed.
    if (!key || key.userId !== getAuthenticatedUser(res).id) {
      throw new AppError(404, "KEY_NOT_FOUND", "API key not found");
    }

    revokeApiKey(db, key.id);
    res.status(200).json({ key: getApiKey(db, key.id) });
  });

  // Tools this user may use, after the role policy (dashboard and chat).
  router.get("/api/tools", async (_req, res) => {
    const visible = await tools.listTools(getAuthenticatedUser(res));

    res.status(200).json({
      tools: visible.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    });
  });

  return router;
}
