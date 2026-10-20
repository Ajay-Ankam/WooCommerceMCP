import type { ChatMessage } from "../chat/types.js";
import type { Database } from "./database.js";

export interface Conversation {
  id: number;
  userId: number;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}

function toConversation(row: Record<string, unknown>): Conversation {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    title: String(row.title),
    messages: JSON.parse(String(row.messages)) as ChatMessage[],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function createConversation(db: Database, userId: number, title: string): Conversation {
  const now = new Date().toISOString();
  const row = db
    .prepare(
      `INSERT INTO chat_conversations (user_id, title, messages, created_at, updated_at)
       VALUES (?, ?, '[]', ?, ?) RETURNING *`,
    )
    .get(userId, title.slice(0, 80), now, now);

  return toConversation(row as Record<string, unknown>);
}

// Scoped to the owner: users can never read or continue someone else's chat.
export function getConversation(db: Database, id: number, userId: number): Conversation | undefined {
  const row = db
    .prepare("SELECT * FROM chat_conversations WHERE id = ? AND user_id = ?")
    .get(id, userId);

  return row ? toConversation(row as Record<string, unknown>) : undefined;
}

export function listConversations(db: Database, userId: number): Array<Omit<Conversation, "messages">> {
  return db
    .prepare(
      "SELECT id, user_id, title, '[]' AS messages, created_at, updated_at FROM chat_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 50",
    )
    .all(userId)
    .map((row) => {
      const { messages: _messages, ...rest } = toConversation(row as Record<string, unknown>);
      return rest;
    });
}

export function saveMessages(db: Database, id: number, messages: ChatMessage[]): void {
  db.prepare("UPDATE chat_conversations SET messages = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify(messages),
    new Date().toISOString(),
    id,
  );
}

export function deleteConversation(db: Database, id: number, userId: number): boolean {
  const result = db
    .prepare("DELETE FROM chat_conversations WHERE id = ? AND user_id = ?")
    .run(id, userId);

  return Number(result.changes) > 0;
}
