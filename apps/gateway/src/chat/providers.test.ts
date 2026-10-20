import assert from "node:assert/strict";
import test from "node:test";

import { LlmError, errorFromResponse } from "./errors.js";
import { FOREIGN_CALL_SIGNATURE, GeminiProvider } from "./providers/gemini.js";
import { createProviders } from "./providers/index.js";
import { GroqProvider } from "./providers/groq.js";
import type { ChatMessage, ToolSpec } from "./types.js";

const API_KEY = "test-key-never-in-url";

const tools: ToolSpec[] = [
  {
    name: "woocommerce__list_orders",
    description: "List orders",
    parameters: {
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "object",
      properties: { after: { type: "string" } },
    },
  },
];

interface Captured {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

// Records each request and replies with the scripted responses in order.
function mockFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Captured[] = [];

  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;

  return { fetchImpl, calls };
}

test("gemini sends tools as JSON Schema, keeps the key out of the URL and parses function calls", async () => {
  const { fetchImpl, calls } = mockFetch([
    {
      status: 200,
      body: {
        candidates: [
          {
            finishReason: "STOP",
            content: {
              role: "model",
              parts: [
                { functionCall: { id: "fc1", name: "woocommerce__list_orders", args: { after: "2026-10-20" } }, thoughtSignature: "sig-abc" },
              ],
            },
          },
        ],
      },
    },
  ]);
  const gemini = new GeminiProvider({ apiKey: API_KEY, model: "gemini-test", timeoutMs: 1000, fetch: fetchImpl });

  const result = await gemini.complete({ system: "sys", messages: [{ role: "user", text: "orders today?" }], tools });

  assert.deepEqual(result.toolCalls, [{ id: "fc1", name: "woocommerce__list_orders", arguments: { after: "2026-10-20" } }]);
  assert.match(calls[0].url, /models\/gemini-test:generateContent$/);
  assert.ok(!calls[0].url.includes(API_KEY));
  assert.equal(calls[0].headers["x-goog-api-key"], API_KEY);

  const declaration = (calls[0].body.tools as Array<{ functionDeclarations: Array<Record<string, unknown>> }>)[0].functionDeclarations[0];
  assert.deepEqual(declaration.parametersJsonSchema, { type: "object", properties: { after: { type: "string" } } });
});

test("gemini replays its own content (thought signatures) and returns function responses", async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 200, body: { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "One order." }] } }] } },
  ]);
  const gemini = new GeminiProvider({ apiKey: API_KEY, model: "m", timeoutMs: 1000, fetch: fetchImpl });
  const native = { role: "model", parts: [{ functionCall: { id: "fc1", name: "t", args: {} }, thoughtSignature: "sig-abc" }] };

  const history: ChatMessage[] = [
    { role: "user", text: "q" },
    { role: "assistant", text: "", toolCalls: [{ id: "fc1", name: "t", arguments: {} }], provider: "gemini", native },
    { role: "tool", toolCallId: "fc1", name: "t", content: "[]", isError: false },
  ];

  const result = await gemini.complete({ system: "s", messages: history, tools: [] });

  assert.equal(result.text, "One order.");
  const contents = calls[0].body.contents as unknown[];
  assert.deepEqual(contents[1], native);
  assert.deepEqual(contents[2], { role: "user", parts: [{ functionResponse: { id: "fc1", name: "t", response: { result: "[]" } } }] });
});

test("provider HTTP failures are classified for fallback", async () => {
  const cases: Array<[number, string]> = [[429, "rate_limit"], [404, "unavailable"], [503, "provider_error"], [401, "auth"], [400, "bad_request"]];

  for (const [status, kind] of cases) {
    const { fetchImpl } = mockFetch([{ status, body: { error: { message: "nope" } } }]);
    const gemini = new GeminiProvider({ apiKey: API_KEY, model: "m", timeoutMs: 1000, fetch: fetchImpl });

    await assert.rejects(
      gemini.complete({ system: "s", messages: [{ role: "user", text: "q" }], tools: [] }),
      (error: unknown) => error instanceof LlmError && error.kind === kind && !error.message.includes(API_KEY),
    );
  }
});

test("a provider that does not answer in time fails with a timeout", async () => {
  const hanging = ((_url: string, init: RequestInit) =>
    new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
    })) as unknown as typeof fetch;
  const groq = new GroqProvider({ apiKey: API_KEY, model: "m", timeoutMs: 50, fetch: hanging });

  await assert.rejects(
    groq.complete({ system: "s", messages: [{ role: "user", text: "q" }], tools: [] }),
    (error: unknown) => error instanceof LlmError && error.kind === "timeout",
  );
});

test("gemini blocked or empty responses are errors, not blank answers", async () => {
  const { fetchImpl } = mockFetch([
    { status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } },
    { status: 200, body: { candidates: [{ finishReason: "MALFORMED_FUNCTION_CALL", content: { role: "model", parts: [] } }] } },
  ]);
  const gemini = new GeminiProvider({ apiKey: API_KEY, model: "m", timeoutMs: 1000, fetch: fetchImpl });
  const request = { system: "s", messages: [{ role: "user" as const, text: "q" }], tools: [] };

  await assert.rejects(gemini.complete(request), /SAFETY/);
  await assert.rejects(gemini.complete(request), /malformed function call/);
});

test("groq maps neutral history, never sends gemini-native data, and validates arguments", async () => {
  const { fetchImpl, calls } = mockFetch([
    {
      status: 200,
      body: {
        choices: [
          {
            finish_reason: "tool_calls",
            message: { content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "t", arguments: '{"x":1}' } }] },
          },
        ],
      },
    },
    { status: 200, body: { choices: [{ message: { tool_calls: [{ id: "c", type: "function", function: { name: "t", arguments: "{not json" } }] } }] } },
  ]);
  const groq = new GroqProvider({ apiKey: API_KEY, model: "openai/gpt-oss-120b", timeoutMs: 1000, fetch: fetchImpl });

  const history: ChatMessage[] = [
    { role: "user", text: "q" },
    { role: "assistant", text: "", toolCalls: [{ id: "gen_1", name: "t", arguments: { a: 1 } }], provider: "gemini", native: { parts: [{ thoughtSignature: "sig-abc" }] } },
    { role: "tool", toolCallId: "gen_1", name: "t", content: "boom", isError: true },
  ];

  const result = await groq.complete({ system: "s", messages: history, tools });

  assert.deepEqual(result.toolCalls, [{ id: "call_1", name: "t", arguments: { x: 1 } }]);
  assert.equal(calls[0].headers.Authorization, `Bearer ${API_KEY}`);
  assert.ok(!JSON.stringify(calls[0].body).includes("sig-abc"));
  assert.deepEqual((calls[0].body.messages as unknown[]).slice(2), [
    { role: "assistant", content: null, tool_calls: [{ id: "gen_1", type: "function", function: { name: "t", arguments: '{"a":1}' } }] },
    { role: "tool", tool_call_id: "gen_1", content: "ERROR: boom" },
  ]);

  await assert.rejects(
    groq.complete({ system: "s", messages: [{ role: "user", text: "q" }], tools }),
    (error: unknown) => error instanceof LlmError && error.kind === "invalid_response",
  );
});

test("provider error text never carries account identifiers", () => {
  const error = errorFromResponse("groq", 429, JSON.stringify({ error: { message: "Rate limit in organization `org_01abcXYZ` on TPM" } }));

  assert.equal(error.kind, "rate_limit");
  assert.ok(!error.message.includes("org_01abcXYZ"));
  assert.match(error.message, /org_\[redacted\]/);
});

test("the fallback chain follows provider order, one entry per model, skipping missing keys", () => {
  const chain = createProviders({
    order: "gemini,groq",
    timeoutMs: 1000,
    gemini: { apiKey: "g", models: "gemini-a, gemini-b" },
    groq: { apiKey: "q", models: "groq-a" },
  });
  assert.deepEqual(chain.map((p) => `${p.name}:${p.model}`), ["gemini:gemini-a", "gemini:gemini-b", "groq:groq-a"]);

  const groqOnly = createProviders({ order: "gemini,groq", timeoutMs: 1000, gemini: { models: "gemini-a" }, groq: { apiKey: "q", models: "groq-a" } });
  assert.deepEqual(groqOnly.map((p) => p.name), ["groq"]);

  assert.throws(() => createProviders({ order: "openai", timeoutMs: 1000, gemini: { models: "" }, groq: { models: "" } }), /Unknown LLM provider/);
});

test("gemini marks function calls made by another provider so Gemini 3 accepts them", async () => {
  const { fetchImpl, calls } = mockFetch([
    { status: 200, body: { candidates: [{ finishReason: "STOP", content: { role: "model", parts: [{ text: "ok" }] } }] } },
  ]);
  const gemini = new GeminiProvider({ apiKey: API_KEY, model: "m", timeoutMs: 1000, thinkingLevel: "low", fetch: fetchImpl });

  await gemini.complete({
    system: "s",
    messages: [
      { role: "user", text: "q" },
      { role: "assistant", text: "", toolCalls: [{ id: "call_9", name: "t", arguments: {} }], provider: "groq", native: {} },
      { role: "tool", toolCallId: "call_9", name: "t", content: "{}", isError: false },
    ],
    tools: [],
  });

  const parts = (calls[0].body.contents as Array<{ parts: Array<Record<string, unknown>> }>)[1].parts;
  assert.equal(parts[0].thoughtSignature, FOREIGN_CALL_SIGNATURE);
  assert.deepEqual(calls[0].body.generationConfig, { thinkingConfig: { thinkingLevel: "low" } });
});
