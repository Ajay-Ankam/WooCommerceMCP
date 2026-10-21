// Provider-neutral conversation model. Providers translate to and from their
// native wire formats, so the agent loop and stored history never depend on
// which LLM produced a turn, and a conversation can move between providers.

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | {
      role: "assistant";
      text: string;
      toolCalls: ToolCall[];
      // Native message exactly as the provider returned it (e.g. Gemini parts
      // carrying thought signatures). Replayed only to that same provider.
      provider?: string;
      native?: unknown;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError: boolean };

// A write the model asked for, held server-side until the user approves or
// rejects it. The browser only ever sends a decision, never the arguments.
export interface PendingAction {
  id: string;
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  provider: string;
  createdAt: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  // JSON Schema of the tool arguments, as published by the upstream MCP server.
  parameters: Record<string, unknown>;
}

export interface CompletionRequest {
  system: string;
  messages: ChatMessage[];
  tools: ToolSpec[];
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  native: unknown;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}
