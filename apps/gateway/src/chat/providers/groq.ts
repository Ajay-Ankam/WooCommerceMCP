import { LlmError, postJson } from "../errors.js";
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ToolCall,
} from "../types.js";

interface GroqToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type GroqMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: GroqToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface GroqResponse {
  choices?: Array<{
    finish_reason?: string;
    message?: { content?: string | null; tool_calls?: GroqToolCall[] };
  }>;
}

export interface GroqOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Groq counts reserved output tokens against the tokens-per-minute limit,
  // so an explicit cap keeps each request within the free tier.
  maxCompletionTokens?: number;
  baseUrl?: string;
  fetch?: typeof fetch;
}

// Groq's native API is the OpenAI chat-completions format.
export class GroqProvider implements LlmProvider {
  readonly name = "groq";
  readonly model: string;

  constructor(private readonly options: GroqOptions) {
    this.model = options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = this.options.baseUrl ?? "https://api.groq.com/openai/v1";

    const body = {
      model: this.model,
      messages: [{ role: "system", content: request.system }, ...toMessages(request.messages)],
      ...(this.options.maxCompletionTokens ? { max_completion_tokens: this.options.maxCompletionTokens } : {}),
      ...(request.tools.length > 0
        ? {
            tools: request.tools.map((tool) => {
              const { $schema: _ignored, ...parameters } = tool.parameters;
              return { type: "function", function: { name: tool.name, description: tool.description, parameters } };
            }),
            tool_choice: "auto",
          }
        : {}),
    };

    const response = (await postJson(
      this.name,
      `${base}/chat/completions`,
      { Authorization: `Bearer ${this.options.apiKey}` },
      body,
      this.options.timeoutMs,
      this.options.fetch ?? fetch,
    )) as GroqResponse;

    return parseResponse(response);
  }
}

// Built from the neutral history (never from another provider's native data).
export function toMessages(messages: ChatMessage[]): GroqMessage[] {
  return messages.map((message): GroqMessage => {
    if (message.role === "user") {
      return { role: "user", content: message.text };
    }

    if (message.role === "tool") {
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.isError ? `ERROR: ${message.content}` : message.content,
      };
    }

    return {
      role: "assistant",
      content: message.text || null,
      ...(message.toolCalls.length > 0
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            })),
          }
        : {}),
    };
  });
}

function parseResponse(response: GroqResponse): CompletionResult {
  const message = response.choices?.[0]?.message;

  if (!message) {
    throw new LlmError("invalid_response", "groq", "Empty response (no choices)");
  }

  const toolCalls: ToolCall[] = (message.tool_calls ?? []).map((call) => {
    let args: unknown;

    try {
      args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      throw new LlmError("invalid_response", "groq", `Malformed arguments for ${call.function.name}`);
    }

    if (typeof args !== "object" || args === null || Array.isArray(args)) {
      throw new LlmError("invalid_response", "groq", `Arguments for ${call.function.name} are not an object`);
    }

    return { id: call.id, name: call.function.name, arguments: args as Record<string, unknown> };
  });

  const text = (message.content ?? "").trim();

  if (!text && toolCalls.length === 0) {
    throw new LlmError("invalid_response", "groq", "Empty response");
  }

  return { text, toolCalls, native: message };
}
