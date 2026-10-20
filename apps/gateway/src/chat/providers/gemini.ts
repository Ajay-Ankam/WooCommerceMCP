import { LlmError, postJson } from "../errors.js";
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ToolCall,
  ToolSpec,
} from "../types.js";

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{ content?: GeminiContent; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
}

// Gemini does not always assign call ids; locally generated ones are marked so
// they are never sent back as if Gemini had issued them.
const GENERATED_ID = "gen_";

// Gemini 3 rejects function calls in the current turn without a thought
// signature. Calls another provider made (after a fallback) have none, so they
// carry Google's documented placeholder that skips validation for that part.
export const FOREIGN_CALL_SIGNATURE = "skip_thought_signature_validator";

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  // Gemini 3 "thinking" depth (low | medium | high). Lower is much faster,
  // which matters for a multi-round tool loop; unset uses the model default.
  thinkingLevel?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

// Native Gemini generateContent API. Native rather than the OpenAI-compatible
// layer because Gemini 3 attaches thought signatures to functionCall parts and
// requires them back on the next request; replaying the model's own content
// verbatim is the documented way to satisfy that.
export class GeminiProvider implements LlmProvider {
  readonly name = "gemini";
  readonly model: string;

  constructor(private readonly options: GeminiOptions) {
    this.model = options.model;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const base = this.options.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const url = `${base}/models/${encodeURIComponent(this.model)}:generateContent`;

    const body = {
      systemInstruction: { parts: [{ text: request.system }] },
      contents: toContents(request.messages),
      ...(this.options.thinkingLevel
        ? { generationConfig: { thinkingConfig: { thinkingLevel: this.options.thinkingLevel } } }
        : {}),
      ...(request.tools.length > 0
        ? {
            tools: [{ functionDeclarations: request.tools.map(toDeclaration) }],
            toolConfig: { functionCallingConfig: { mode: "AUTO" } },
          }
        : {}),
    };

    // The API key travels in a header, never in the URL (URLs end up in logs).
    const response = (await postJson(
      this.name,
      url,
      { "x-goog-api-key": this.options.apiKey },
      body,
      this.options.timeoutMs,
      this.options.fetch ?? fetch,
    )) as GeminiResponse;

    return parseResponse(response);
  }
}

function toDeclaration(tool: ToolSpec) {
  // "$schema" is metadata, not part of the argument schema.
  const { $schema: _ignored, ...schema } = tool.parameters;

  return { name: tool.name, description: tool.description, parametersJsonSchema: schema };
}

export function toContents(messages: ChatMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.text }] });
      continue;
    }

    if (message.role === "assistant") {
      if (message.provider === "gemini" && message.native) {
        contents.push(message.native as GeminiContent);
        continue;
      }

      const parts: GeminiPart[] = [
        ...(message.text ? [{ text: message.text }] : []),
        ...message.toolCalls.map((call) => ({
          functionCall: { ...callId(call.id), name: call.name, args: call.arguments },
          thoughtSignature: FOREIGN_CALL_SIGNATURE,
        })),
      ];

      if (parts.length > 0) {
        contents.push({ role: "model", parts });
      }
      continue;
    }

    // Consecutive tool results are sent together as one user turn.
    const part: GeminiPart = {
      functionResponse: {
        ...callId(message.toolCallId),
        name: message.name,
        response: message.isError ? { error: message.content } : { result: message.content },
      },
    };
    const previous = contents[contents.length - 1];

    if (previous?.role === "user" && previous.parts.every((p) => p.functionResponse)) {
      previous.parts.push(part);
    } else {
      contents.push({ role: "user", parts: [part] });
    }
  }

  return contents;
}

function callId(id: string): { id?: string } {
  return id.startsWith(GENERATED_ID) ? {} : { id };
}

function parseResponse(response: GeminiResponse): CompletionResult {
  const candidate = response.candidates?.[0];

  if (!candidate?.content) {
    const reason = response.promptFeedback?.blockReason ?? candidate?.finishReason ?? "no candidates";
    throw new LlmError("invalid_response", "gemini", `Empty response (${reason})`);
  }

  if (candidate.finishReason === "MALFORMED_FUNCTION_CALL") {
    throw new LlmError("invalid_response", "gemini", "Model produced a malformed function call");
  }

  const parts = candidate.content.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();

  const toolCalls: ToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, index) => ({
      id: p.functionCall!.id ?? `${GENERATED_ID}${Date.now().toString(36)}_${index}`,
      name: p.functionCall!.name,
      arguments: p.functionCall!.args ?? {},
    }));

  if (!text && toolCalls.length === 0) {
    throw new LlmError("invalid_response", "gemini", `Empty response (${candidate.finishReason ?? "unknown"})`);
  }

  return { text, toolCalls, native: candidate.content };
}
