import type { LlmProvider } from "../types.js";
import { GeminiProvider } from "./gemini.js";
import { GroqProvider } from "./groq.js";

export interface ProviderConfig {
  order: string;
  timeoutMs: number;
  gemini: { apiKey?: string; models: string; thinkingLevel?: string };
  groq: { apiKey?: string; models: string; maxCompletionTokens?: number };
}

const list = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

// Builds the fallback chain: providers in the configured order, each expanded
// to one entry per model. A provider without an API key is skipped, so the
// chat still works with a single key.
export function createProviders(config: ProviderConfig): LlmProvider[] {
  const providers: LlmProvider[] = [];

  for (const name of list(config.order.toLowerCase())) {
    if (name === "gemini") {
      const { apiKey, thinkingLevel } = config.gemini;
      if (apiKey) {
        for (const model of list(config.gemini.models)) {
          providers.push(new GeminiProvider({ apiKey, model, thinkingLevel, timeoutMs: config.timeoutMs }));
        }
      }
    } else if (name === "groq") {
      const { apiKey, maxCompletionTokens } = config.groq;
      if (apiKey) {
        for (const model of list(config.groq.models)) {
          providers.push(new GroqProvider({ apiKey, model, maxCompletionTokens, timeoutMs: config.timeoutMs }));
        }
      }
    } else {
      throw new Error(`Unknown LLM provider "${name}" in LLM_PROVIDERS`);
    }
  }

  return providers;
}
