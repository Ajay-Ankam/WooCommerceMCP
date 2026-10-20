import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server as HttpServer } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createApp } from "../app.js";
import { listAudit } from "../db/audit.js";
import { createServer, setServerEnabled } from "../db/servers.js";
import { createUser, issueApiKey, revokeApiKey } from "../db/users.js";
import type { GatewayContext } from "../context.js";
import {
  close,
  createTestContext,
  listen,
  startFakeUpstream,
} from "../test-support.js";

const ALPHA_SECRET = "alpha-upstream-secret-value";

let context: GatewayContext;
let gatewayUrl: string;
const servers: HttpServer[] = [];
let keyA: string;
let keyB: string;
let keyBId: number;

before(async () => {
  const alpha = await startFakeUpstream({
    name: "alpha",
    tools: ["echo", "list_orders"],
    bearerToken: ALPHA_SECRET,
  });
  const beta = await startFakeUpstream({ name: "beta", tools: ["echo", "convert"] });
  const slow = await startFakeUpstream({ name: "slow", tools: ["echo"], delayMs: 1500 });
  servers.push(alpha.server, beta.server, slow.server);

  context = createTestContext(400);
  const { db } = context;

  createServer(db, { slug: "alpha", name: "Alpha", url: alpha.url, authType: "bearer", authSecret: ALPHA_SECRET });
  createServer(db, { slug: "beta", name: "Beta", url: beta.url, authType: "none" });
  createServer(db, { slug: "slow", name: "Slow", url: slow.url, authType: "none" });
  // Nothing listens on port 9: a dead upstream.
  createServer(db, { slug: "dead", name: "Dead", url: "http://127.0.0.1:9/mcp", authType: "none" });

  const userA = createUser(db, { email: "a@test.dev", name: "User A", role: "admin" });
  const userB = createUser(db, { email: "b@test.dev", name: "User B", role: "member" });
  keyA = issueApiKey(db, userA.id, "test").key;
  const issuedB = issueApiKey(db, userB.id, "test");
  keyB = issuedB.key;
  keyBId = issuedB.summary.id;

  const gateway = await listen(createApp(context));
  servers.push(gateway.server);
  gatewayUrl = gateway.url;
});

after(async () => {
  await context.upstreams.close();
  await Promise.all(servers.map(close));
});

async function connect(key: string): Promise<Client> {
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${gatewayUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

function text(result: unknown): string {
  const content = (result as CallToolResult).content[0];
  return content.type === "text" ? content.text : "";
}

test("lists namespaced tools from every healthy upstream despite slow and dead ones", async () => {
  const client = await connect(keyB);
  const started = Date.now();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();

  assert.deepEqual(names, ["alpha__echo", "alpha__list_orders", "beta__convert", "beta__echo"]);
  assert.ok(Date.now() - started < 1500, "listing must not wait for the slow upstream");
  assert.ok(!JSON.stringify(tools).includes(ALPHA_SECRET));
  await client.close();
});

test("routes colliding tool names to the right upstream", async () => {
  const client = await connect(keyA);
  const alpha = JSON.parse(text(await client.callTool({ name: "alpha__echo", arguments: { value: "x" } })));
  const beta = JSON.parse(text(await client.callTool({ name: "beta__echo", arguments: { value: "y" } })));

  assert.deepEqual(alpha, { server: "alpha", tool: "echo", args: { value: "x" } });
  assert.deepEqual(beta, { server: "beta", tool: "echo", args: { value: "y" } });
  await client.close();
});

test("returns clear tool errors for timeouts, dead upstreams and unknown tools", async () => {
  const client = await connect(keyA);

  const slow = (await client.callTool({ name: "slow__echo", arguments: {} })) as CallToolResult;
  assert.equal(slow.isError, true);
  assert.match(text(slow), /Upstream "slow" timed out after 400ms/);

  const dead = (await client.callTool({ name: "dead__echo", arguments: {} })) as CallToolResult;
  assert.equal(dead.isError, true);
  assert.match(text(dead), /Upstream "dead" failed/);

  const unknown = (await client.callTool({ name: "nope__echo", arguments: {} })) as CallToolResult;
  assert.equal(unknown.isError, true);

  // Healthy upstreams still work after the failures.
  const ok = (await client.callTool({ name: "beta__convert", arguments: {} })) as CallToolResult;
  assert.notEqual(ok.isError, true);
  await client.close();
});

test("REST server list reports status without exposing credentials", async () => {
  const response = await fetch(`${gatewayUrl}/api/mcp/servers`, {
    headers: { Authorization: `Bearer ${keyA}` },
  });
  const body = await response.text();
  const servers = JSON.parse(body).servers as Array<{ slug: string; status: string; hasCredential: boolean }>;
  const bySlug = Object.fromEntries(servers.map((s) => [s.slug, s]));

  assert.equal(response.status, 200);
  assert.ok(!body.includes(ALPHA_SECRET));
  assert.equal(bySlug.alpha.hasCredential, true);
  assert.equal(bySlug.alpha.status, "connected");
  assert.equal(bySlug.dead.status, "unreachable");
});

test("disabling a server hides its tools and rejects calls", async () => {
  setServerEnabled(context.db, "beta", false);

  try {
    const client = await connect(keyB);
    const { tools } = await client.listTools();
    assert.ok(tools.every((t) => !t.name.startsWith("beta__")));

    const result = (await client.callTool({ name: "beta__echo", arguments: {} })) as CallToolResult;
    assert.equal(result.isError, true);
    assert.match(text(result), /disabled/);
    await client.close();
  } finally {
    setServerEnabled(context.db, "beta", true);
  }
});

test("rejects missing, unknown and revoked keys", async () => {
  const noKey = await fetch(`${gatewayUrl}/mcp`, { method: "POST" });
  assert.equal(noKey.status, 401);

  await assert.rejects(connect("ajay_not-a-real-key"));

  const client = await connect(keyB);
  revokeApiKey(context.db, keyBId);
  await assert.rejects(client.callTool({ name: "alpha__echo", arguments: {} }));
  await client.close().catch(() => {});
});

test("audits every call with the right user, server, tool and outcome", () => {
  const audit = listAudit(context.db, { limit: 500 });
  const find = (email: string, server: string | null, tool: string) =>
    audit.find((e) => e.userEmail === email && e.serverSlug === server && e.tool === tool);

  assert.equal(find("a@test.dev", "alpha", "echo")?.outcome, "success");
  assert.equal(find("a@test.dev", "slow", "echo")?.outcome, "error");
  assert.equal(find("a@test.dev", "dead", "echo")?.outcome, "error");
  assert.equal(find("b@test.dev", "beta", "echo")?.outcome, "denied");
  assert.equal(find("b@test.dev", null, "alpha__echo")?.outcome, "denied");
  assert.ok(audit.every((e) => e.source === "mcp" && e.durationMs >= 0));
});
