import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { Server as HttpServer } from "node:http";

import { createApp } from "../app.js";
import { createGatewayContext, type GatewayContext } from "../context.js";
import { listAudit } from "../db/audit.js";
import { getConversation } from "../db/conversations.js";
import { createServer } from "../db/servers.js";
import { createUser, type User } from "../db/users.js";
import { close, listen, startFakeUpstream } from "../test-support.js";
import { ActionExpiredError, ActionNotPendingError, ChatAgent, ChatUnavailableError } from "./agent.js";
import { LlmError } from "./errors.js";
import type { CompletionRequest, CompletionResult, LlmProvider } from "./types.js";

type Step = CompletionResult | LlmError;

// Scripted provider: returns (or throws) the next step and records requests.
class ScriptedProvider implements LlmProvider {
  readonly requests: CompletionRequest[] = [];

  constructor(
    readonly name: string,
    readonly model: string,
    private readonly steps: Step[],
  ) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(structuredClone(request));
    const step = this.steps.shift();

    if (!step) {
      throw new LlmError("provider_error", this.name, "script exhausted");
    }

    if (step instanceof LlmError) {
      throw step;
    }

    return step;
  }
}

const answer = (text: string): CompletionResult => ({ text, toolCalls: [], native: null });
const callTool = (id: string, name: string, args: Record<string, unknown>): CompletionResult => ({
  text: "",
  toolCalls: [{ id, name, arguments: args }],
  native: { marker: id },
});

let context: GatewayContext;
let admin: User;
let member: User;
let upstream: HttpServer;
const writes: unknown[] = [];

before(async () => {
  const shop = await startFakeUpstream({
    name: "shop",
    tools: ["list_orders", "create_product"],
    onCall: (tool, args) => {
      if (tool === "create_product") writes.push(args);
    },
  });
  upstream = shop.server;

  context = createGatewayContext({ dbPath: ":memory:", upstreamTimeoutMs: 2000 });
  createServer(context.db, { slug: "shop", name: "Shop", url: shop.url, authType: "none", adminOnlyTools: ["create_product"] });
  admin = createUser(context.db, { email: "a@test.dev", name: "User A", role: "admin" });
  member = createUser(context.db, { email: "b@test.dev", name: "User B", role: "member" });
});

beforeEach(() => {
  writes.length = 0;
});

after(async () => {
  await context.upstreams.close();
  await close(upstream);
});

function agent(...providers: LlmProvider[]) {
  return new ChatAgent(context.db, context.tools, providers, { maxToolRounds: 5, timezone: "UTC" });
}

test("falls back to the next provider when the primary is rate limited", async () => {
  const gemini = new ScriptedProvider("gemini", "g", [new LlmError("rate_limit", "gemini", "HTTP 429")]);
  const groq = new ScriptedProvider("groq", "q", [answer("Hello from Groq")]);

  const result = await agent(gemini, groq).run(admin, undefined, "hi");

  assert.equal(result.reply, "Hello from Groq");
  assert.equal(result.provider, "groq");
  assert.deepEqual(result.fallbacks.map((f) => [f.provider, f.kind]), [["gemini", "rate_limit"]]);
});

test("an approved write is never executed again by the fallback", async () => {
  const args = { value: "AJAY Mug" };
  const gemini = new ScriptedProvider("gemini", "g", [
    callTool("fc1", "shop__create_product", args),
    new LlmError("timeout", "gemini", "No response within 30000ms"),
  ]);
  // The fallback model, seeing the history, asks for the identical write again.
  const groq = new ScriptedProvider("groq", "q", [
    callTool("call_1", "shop__create_product", { ...args }),
    answer("Created AJAY Mug."),
  ]);
  const chat = agent(gemini, groq);

  const paused = await chat.run(admin, undefined, "create AJAY Mug");
  assert.equal(writes.length, 0, "nothing runs before approval");
  const result = await chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "approve");

  assert.equal(writes.length, 1, "the upstream write ran exactly once");
  assert.deepEqual(result.toolCalls.map((t) => [t.provider, t.deduplicated, t.isError]), [
    ["gemini", false, false],
    ["groq", true, false],
  ]);
  assert.equal(result.reply, "Created AJAY Mug.");

  // The fallback received the executed call and its result in its history.
  const handedOver = groq.requests[0].messages;
  assert.equal(handedOver[handedOver.length - 1].role, "tool");
  assert.match(JSON.stringify(handedOver), /AJAY Mug/);
});

const calls = (...toolCalls: Array<[string, string, Record<string, unknown>]>): CompletionResult => ({
  text: "I will do that once you confirm.",
  toolCalls: toolCalls.map(([id, name, args]) => ({ id, name, arguments: args })),
  native: null,
});

test("writes pause for confirmation while reads in the same round still run", async () => {
  const provider = new ScriptedProvider("gemini", "g", [
    calls(
      ["c1", "shop__list_orders", {}],
      ["c2", "shop__create_product", { value: "Lamp" }],
      ["c3", "shop__create_product", { value: "Second" }],
    ),
  ]);

  const result = await agent(provider).run(admin, undefined, "list orders and create two products");

  assert.equal(writes.length, 0);
  assert.equal(result.reply, "I will do that once you confirm.");
  assert.deepEqual(result.toolCalls.map((t) => t.name), ["shop__list_orders"]);
  assert.equal(result.pendingAction?.name, "shop__create_product");
  assert.deepEqual(result.pendingAction?.arguments, { value: "Lamp" });
  assert.ok(Date.parse(result.pendingAction!.expiresAt) > Date.now());

  const stored = getConversation(context.db, result.conversationId, admin.id)!;
  assert.equal(stored.pendingAction?.id, result.pendingAction?.id);
  // The second write was refused, not queued: only one decision is ever outstanding.
  const refused = stored.messages.find((m) => m.role === "tool" && m.toolCallId === "c3");
  assert.match(JSON.stringify(refused), /already waiting/);
});

test("approving runs exactly the stored arguments once, in provider order, then continues", async () => {
  const provider = new ScriptedProvider("gemini", "g", [
    calls(["c1", "shop__list_orders", {}], ["c2", "shop__create_product", { value: "Lamp" }]),
    answer("Created Lamp."),
  ]);
  const chat = agent(provider);
  const paused = await chat.run(admin, undefined, "create Lamp");

  const result = await chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "approve");

  assert.deepEqual(writes, [{ value: "Lamp" }]);
  assert.equal(result.reply, "Created Lamp.");
  assert.equal(result.pendingAction, null);
  assert.deepEqual(result.toolCalls.map((t) => [t.name, t.isError]), [["shop__create_product", false]]);

  // Tool results follow the call order of the assistant message that asked for them.
  const history = provider.requests[1].messages;
  assert.deepEqual(
    history.filter((m) => m.role === "tool").map((m) => (m as { toolCallId: string }).toolCallId),
    ["c1", "c2"],
  );
  assert.equal(getConversation(context.db, paused.conversationId, admin.id)!.pendingAction, null);

  const success = listAudit(context.db, { userId: admin.id, outcome: "success" })[0];
  assert.deepEqual([success.source, success.tool], ["chat", "create_product"]);

  // A replayed or double-clicked approval cannot run the write again.
  await assert.rejects(
    chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "approve"),
    ActionNotPendingError,
  );
  assert.equal(writes.length, 1);
});

test("rejecting runs nothing, costs no LLM call and is audited as denied", async () => {
  const provider = new ScriptedProvider("gemini", "g", [calls(["c1", "shop__create_product", { value: "Nope" }])]);
  const chat = agent(provider);
  const paused = await chat.run(admin, undefined, "create Nope");

  const result = await chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "reject");

  assert.equal(writes.length, 0);
  assert.equal(provider.requests.length, 1, "no model call for a decline");
  assert.match(result.reply, /Cancelled/);
  const entry = listAudit(context.db, { userId: admin.id, outcome: "denied" })[0];
  assert.deepEqual([entry.source, entry.tool, entry.error], ["chat", "create_product", "Declined by user"]);

  const stored = getConversation(context.db, paused.conversationId, admin.id)!;
  assert.deepEqual(stored.messages.map((m) => m.role), ["user", "assistant", "tool", "assistant"]);
});

test("an expired confirmation is not run", async () => {
  const provider = new ScriptedProvider("gemini", "g", [calls(["c1", "shop__create_product", { value: "Late" }])]);
  const chat = new ChatAgent(context.db, context.tools, [provider], { maxToolRounds: 5, timezone: "UTC", confirmationTtlMs: -1 });
  const paused = await chat.run(admin, undefined, "create Late");

  await assert.rejects(chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "approve"), ActionExpiredError);
  assert.equal(writes.length, 0);
  assert.equal(listAudit(context.db, { userId: admin.id, outcome: "denied" })[0].error, "Confirmation expired");
});

test("a new message instead of a decision declines the waiting write", async () => {
  const provider = new ScriptedProvider("gemini", "g", [
    calls(["c1", "shop__create_product", { value: "Skipped" }]),
    answer("Okay."),
  ]);
  const chat = agent(provider);
  const paused = await chat.run(admin, undefined, "create Skipped");

  await chat.run(admin, paused.conversationId, "actually, never mind");

  assert.equal(writes.length, 0);
  const history = provider.requests[1].messages;
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "tool", "user"]);
  assert.match(JSON.stringify(history[2]), /sent a new message/);
  await assert.rejects(chat.resolve(admin, paused.conversationId, paused.pendingAction!.id, "approve"), ActionNotPendingError);
});

test("only the conversation owner can decide, and members never get write confirmations", async () => {
  const provider = new ScriptedProvider("gemini", "g", [calls(["c1", "shop__create_product", { value: "Mine" }])]);
  const chat = agent(provider);
  const paused = await chat.run(admin, undefined, "create Mine");

  await assert.rejects(chat.resolve(member, paused.conversationId, paused.pendingAction!.id, "approve"), /Conversation not found/);
  assert.equal(writes.length, 0);

  const memberProvider = new ScriptedProvider("gemini", "g", [calls(["c1", "shop__create_product", { value: "x" }]), answer("Not allowed.")]);
  const result = await agent(memberProvider).run(member, undefined, "create x");
  assert.equal(result.pendingAction, null);
  assert.equal(result.toolCalls[0].isError, true);
});

test("tools the upstream annotates as writes also need confirmation", () => {
  const tool = (annotations: Record<string, boolean>) => ({ name: "shop__list_orders", inputSchema: { type: "object" as const }, annotations });

  assert.equal(context.tools.needsConfirmation(tool({})), false);
  assert.equal(context.tools.needsConfirmation(tool({ readOnlyHint: true })), false);
  assert.equal(context.tools.needsConfirmation(tool({ readOnlyHint: false })), true);
  assert.equal(context.tools.needsConfirmation(tool({ destructiveHint: true })), true);
  assert.equal(context.tools.needsConfirmation({ name: "shop__create_product", inputSchema: { type: "object" } }), true);
});

test("when every provider fails the error is explicit and no answer is invented", async () => {
  const gemini = new ScriptedProvider("gemini", "g", [
    callTool("fc1", "shop__list_orders", {}),
    new LlmError("unavailable", "gemini", "HTTP 404: model not found"),
  ]);
  const groq = new ScriptedProvider("groq", "q", [new LlmError("rate_limit", "groq", "HTTP 429")]);

  const error = await agent(gemini, groq).run(member, undefined, "orders?").catch((e: unknown) => e);

  assert.ok(error instanceof ChatUnavailableError);
  assert.match(error.message, /gemini \(unavailable/);
  assert.match(error.message, /groq \(rate_limit/);
  assert.deepEqual(error.toolCalls.map((t) => t.name), ["shop__list_orders"]);

  // History keeps the user message and the executed tool result, but no
  // fabricated assistant answer after it.
  const stored = getConversation(context.db, error.conversationId, member.id)!;
  assert.deepEqual(stored.messages.map((m) => m.role), ["user", "assistant", "tool"]);
});

test("chat tool calls use the user's role policy and are audited as chat under that user", async () => {
  const memberProvider = new ScriptedProvider("gemini", "g", [
    callTool("fc1", "shop__create_product", { value: "x" }),
    answer("I am not allowed to create products."),
  ]);

  const result = await agent(memberProvider).run(member, undefined, "create a product");

  assert.deepEqual(memberProvider.requests[0].tools.map((t) => t.name), ["shop__list_orders"]);
  assert.equal(result.toolCalls[0].isError, true);
  assert.equal(writes.length, 0);

  const entry = listAudit(context.db, { userId: member.id, outcome: "denied" })[0];
  assert.equal(entry.source, "chat");
  assert.equal(entry.tool, "create_product");
});

test("conversations continue across turns and stay private to their owner", async () => {
  const first = new ScriptedProvider("gemini", "g", [answer("First answer")]);
  const { conversationId } = await agent(first).run(admin, undefined, "first");

  const second = new ScriptedProvider("gemini", "g", [answer("Second answer")]);
  await agent(second).run(admin, conversationId, "second");

  assert.deepEqual(second.requests[0].messages.map((m) => m.role), ["user", "assistant", "user"]);
  await assert.rejects(agent(second).run(member, conversationId, "peek"), /Conversation not found/);
});

test("chat API requires a session and reports provider failures as 503 without leaking keys", async () => {
  const failing = new ScriptedProvider("gemini", "gemini-x", [new LlmError("rate_limit", "gemini", "HTTP 429")]);
  const api = createGatewayContext({
    dbPath: ":memory:",
    upstreamTimeoutMs: 2000,
    chat: { providers: [failing] },
    seed: { adminEmail: "admin@test.dev", adminPassword: "admin-password-123" },
  });
  const { server, url } = await listen(createApp(api));

  try {
    assert.equal((await fetch(`${url}/api/chat/status`)).status, 401);

    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.dev", password: "admin-password-123" }),
    });
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
    const headers = { Cookie: cookie, "Content-Type": "application/json" };

    const status = await (await fetch(`${url}/api/chat/status`, { headers })).json();
    assert.deepEqual(status, { enabled: true, providers: [{ provider: "gemini", model: "gemini-x" }] });

    const response = await fetch(`${url}/api/chat`, { method: "POST", headers, body: JSON.stringify({ message: "hi" }) });
    const body = (await response.json()) as { error: { code: string }; failures: unknown[] };
    assert.equal(response.status, 503);
    assert.equal(body.error.code, "LLM_UNAVAILABLE");
    assert.equal(body.failures.length, 1);
  } finally {
    await api.upstreams.close();
    await close(server);
  }
});

test("confirmation API: pending action is visible, decided once, and scoped to its owner", async () => {
  const shop = await startFakeUpstream({ name: "shop", tools: ["create_product"], onCall: (_t, args) => writes.push(args) });
  const provider = new ScriptedProvider("gemini", "g", [calls(["c1", "shop__create_product", { value: "Desk" }]), answer("Created Desk.")]);
  const api = createGatewayContext({
    dbPath: ":memory:",
    upstreamTimeoutMs: 2000,
    chat: { providers: [provider] },
    seed: { adminEmail: "admin@test.dev", adminPassword: "admin-password-123" },
  });
  createServer(api.db, { slug: "shop", name: "Shop", url: shop.url, authType: "none", adminOnlyTools: ["create_product"] });
  const { server, url } = await listen(createApp(api));

  try {
    const login = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@test.dev", password: "admin-password-123" }),
    });
    const headers = { Cookie: (login.headers.get("set-cookie") ?? "").split(";")[0], "Content-Type": "application/json" };
    const post = (path: string, body: unknown) => fetch(`${url}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

    const turn = await (await post("/api/chat", { message: "create Desk" })).json();
    assert.equal(turn.pendingAction.name, "shop__create_product");
    const path = `/api/chat/conversations/${turn.conversationId}/actions/${turn.pendingAction.id}`;

    // Reloading the conversation shows the card; the browser never sends arguments.
    const reloaded = await (await fetch(`${url}/api/chat/conversations/${turn.conversationId}`, { headers })).json();
    assert.equal(reloaded.pendingAction.id, turn.pendingAction.id);
    assert.equal((await post(path, { decision: "approve", arguments: { value: "Hacked" } })).status, 400);
    assert.equal((await post(path, { decision: "maybe" })).status, 400);

    const approved = await post(path, { decision: "approve" });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).reply, "Created Desk.");
    assert.deepEqual(writes, [{ value: "Desk" }]);

    const replay = await post(path, { decision: "approve" });
    assert.equal(replay.status, 409);
    assert.equal((await replay.json()).error.code, "ACTION_NOT_PENDING");
    assert.equal((await post(`/api/chat/conversations/999/actions/x`, { decision: "reject" })).status, 404);
    assert.equal((await fetch(`${url}${path}`, { method: "POST", body: "{}" })).status, 401);
  } finally {
    await api.upstreams.close();
    await close(server);
    await close(shop.server);
  }
});

test("chat reports that it is not configured when no provider has a key", async () => {
  await assert.rejects(agent().run(admin, undefined, "hi"), /no LLM provider configured/);
});
