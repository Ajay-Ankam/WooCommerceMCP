import { Router } from "express";
import { z } from "zod";

import {
  ChatNotConfiguredError,
  ChatUnavailableError,
  ConversationNotFoundError,
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

    res.status(200).json({ ...conversation, messages: conversation.messages.map(toView) });
  });

  router.delete("/api/chat/conversations/:id", (req, res) => {
    if (!deleteConversation(db, parseId(req.params.id), getAuthenticatedUser(res).id)) {
      throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found");
    }

    res.status(204).end();
  });

  router.post("/api/chat", async (req, res) => {
    const { conversationId, message } = parseBody(chatSchema, req.body);

    try {
      res.status(200).json(await chat.run(getAuthenticatedUser(res), conversationId, message));
    } catch (error) {
      if (error instanceof ChatUnavailableError) {
        res.status(503).json({
          error: { code: "LLM_UNAVAILABLE", message: error.message, requestId: req.id },
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

      throw error;
    }
  });

  return router;
}
