import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  ActionExpiredError,
  ActionNotPendingError,
  ChatNotConfiguredError,
  ChatUnavailableError,
  ConversationNotFoundError,
  type ChatResult,
} from "../chat/agent.js";
import type { ChatMessage } from "../chat/types.js";
import type { GatewayContext } from "../context.js";
import {
  deleteConversation,
  getConversation,
  listConversations,
} from "../db/conversations.js";
import { AppError } from "../lib/app-error.js";
import { getAuthenticatedUser } from "../middleware/api-key-auth.js";
import { requireJsonForMutations, requireSession } from "../middleware/session-auth.js";
import { parseBody, parseId } from "./validation.js";

const chatSchema = z
  .object({
    conversationId: z.number().int().positive().optional(),
    message: z.string().trim().min(1).max(4000),
  })
  .strict();

const decisionSchema = z.object({ decision: z.enum(["approve", "reject"]) }).strict();

// What the dashboard renders: provider-native payloads stay server-side.
function toView(message: ChatMessage) {
  if (message.role === "assistant") {
    return { role: message.role, text: message.text, toolCalls: message.toolCalls, provider: message.provider ?? null };
  }

  return message;
}

// The chat runs as the logged-in dashboard user (session cookie), so every
// tool call it makes is policy-checked and audited under that user.
export function createChatRouter({ db, chat }: GatewayContext) {
  const router = Router();

  router.use("/api/chat", requireSession(db), requireJsonForMutations);

  // Provider names and models only; API keys never leave the server.
  router.get("/api/chat/status", (_req, res) => {
    res.status(200).json({ enabled: chat.configured.length > 0, providers: chat.configured });
  });

  router.get("/api/chat/conversations", (_req, res) => {
    res.status(200).json({ conversations: listConversations(db, getAuthenticatedUser(res).id) });
  });

  router.get("/api/chat/conversations/:id", (req, res) => {
    const conversation = getConversation(db, parseId(req.params.id), getAuthenticatedUser(res).id);

    if (!conversation) {
      throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    res.status(200).json({
      ...conversation,
      messages: conversation.messages.map(toView),
      pendingAction: conversation.pendingAction ? chat.viewPending(conversation.pendingAction) : null,
    });
  });

  router.delete("/api/chat/conversations/:id", (req, res) => {
    if (!deleteConversation(db, parseId(req.params.id), getAuthenticatedUser(res).id)) {
      throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    res.status(204).end();
  });

  // Runs a chat turn, mapping agent failures to API errors. Shared by new
  // messages and confirmation decisions, which both continue the agent loop.
  async function respond(res: Response, requestId: Request["id"], turn: () => Promise<ChatResult>) {
    try {
      res.status(200).json(await turn());
    } catch (error) {
      if (error instanceof ChatUnavailableError) {
        res.status(503).json({
          error: { code: "LLM_UNAVAILABLE", message: error.message, requestId },
          conversationId: error.conversationId,
          failures: error.failures,
          toolCalls: error.toolCalls,
        });
        return;
      }

      if (error instanceof ChatNotConfiguredError) {
        throw new AppError(503, "CHAT_NOT_CONFIGURED", error.message);
      }

      if (error instanceof ConversationNotFoundError) {
        throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
      }

      if (error instanceof ActionNotPendingError) {
        throw new AppError(409, "ACTION_NOT_PENDING", error.message);
      }

      if (error instanceof ActionExpiredError) {
        throw new AppError(410, "ACTION_EXPIRED", error.message);
      }

      throw error;
    }
  }

  router.post("/api/chat", async (req, res) => {
    const { conversationId, message } = parseBody(chatSchema, req.body);

    await respond(res, req.id, () => chat.run(getAuthenticatedUser(res), conversationId, message));
  });

  // Approve or reject a write the agent paused on. The body carries only the
  // decision; the arguments that run are the ones stored with the action.
  router.post("/api/chat/conversations/:id/actions/:actionId", async (req, res) => {
    const id = parseId(req.params.id);
    const { decision } = parseBody(decisionSchema, req.body);

    await respond(res, req.id, () => chat.resolve(getAuthenticatedUser(res), id, String(req.params.actionId), decision));
  });

  return router;
}
