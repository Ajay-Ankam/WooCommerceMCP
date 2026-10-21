import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server as HttpServer } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { createApp } from "../app.js";
import { createGatewayContext, type GatewayContext } from "../context.js";
import { getServerBySlug } from "../db/servers.js";
import { close, listen, startFakeUpstream } from "../test-support.js";

const ADMIN = { email: "admin@test.dev", password: "admin-password-123" };
const SHOP_SECRET = "shop-upstream-secret-value";

let context: GatewayContext;
let baseUrl: string;
let shopUrl: string;
const servers: HttpServer[] = [];

// Minimal cookie-aware client for the dashboard API.
class Browser {
  private cookie = "";

  async request(method: string, path: string, body?: unknown, contentType = "application/json") {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(method === "GET" ? {} : { "Content-Type": contentType }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      this.cookie = setCookie.split(";")[0];
    }

    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, raw: text, setCookie };
  }
}

async function mcp(key: string): Promise<Client> {
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

before(async () => {
  const shop = await startFakeUpstream({
    name: "shop",
    tools: ["list_orders", "create_product"],
    bearerToken: SHOP_SECRET,
  });
  servers.push(shop.server);
  shopUrl = shop.url;

  context = createGatewayContext({
    dbPath: ":memory:",
    upstreamTimeoutMs: 2000,
    seed: { adminEmail: ADMIN.email, adminPassword: ADMIN.password },
  });

  const gateway = await listen(createApp(context));
  servers.push(gateway.server);
  baseUrl = gateway.url;
});

after(async () => {
  await context.upstreams.close();
  await Promise.all(servers.map(close));
});

const admin = new Browser();
const member = new Browser();
let memberId: number;

test("bootstrap admin logs in with an HttpOnly SameSite=Strict session", async () => {
  assert.equal((await new Browser().request("POST", "/api/auth/login", { ...ADMIN, password: "wrong-password" })).status, 401);
  assert.equal((await new Browser().request("GET", "/api/me")).status, 401);

  const login = await admin.request("POST", "/api/auth/login", ADMIN);
  assert.equal(login.status, 200);
  assert.match(login.setCookie ?? "", /HttpOnly/i);
  assert.match(login.setCookie ?? "", /SameSite=Strict/i);

  const me = await admin.request("GET", "/api/me");
  assert.equal(me.body.user.role, "admin");
});

test("mutations without a JSON content type are rejected (CSRF)", async () => {
  const response = await admin.request("POST", "/api/admin/users", { email: "x@test.dev", name: "X" }, "text/plain");
  assert.equal(response.status, 415);
});

test("admin registers a server; the credential is write-only", async () => {
  const created = await admin.request("POST", "/api/admin/servers", {
    slug: "shop",
    name: "Shop",
    url: shopUrl,
    authType: "bearer",
    authSecret: SHOP_SECRET,
    adminOnlyTools: ["create_product"],
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.server.status, "connected");
  assert.equal(created.body.server.hasCredential, true);
  assert.ok(!created.raw.includes(SHOP_SECRET));
  assert.deepEqual(
    created.body.server.tools.map((t: { exposedName: string; adminOnly: boolean }) => [t.exposedName, t.adminOnly]),
    [["shop__list_orders", false], ["shop__create_product", true]],
  );
  assert.equal(created.body.server.tools[0].inputSchema.type, "object");

  // Editing other fields keeps the stored credential.
  const renamed = await admin.request("PATCH", "/api/admin/servers/shop", { name: "Shop Renamed" });
  assert.equal(renamed.body.server.name, "Shop Renamed");
  assert.equal(renamed.body.server.status, "connected");
  assert.equal(getServerBySlug(context.db, "shop")?.authSecret, SHOP_SECRET);

  const list = await admin.request("GET", "/api/admin/servers");
  assert.ok(!list.raw.includes(SHOP_SECRET));

  const bad = await admin.request("POST", "/api/admin/servers", { slug: "x", name: "X", url: "http://x/mcp", authType: "bearer" });
  assert.equal(bad.status, 400);
});

test("pasted credentials are trimmed; whitespace-only credentials are rejected", async () => {
  // The test upstream compares the bearer token exactly, so "connected" proves the trim.
  const created = await admin.request("POST", "/api/admin/servers", {
    slug: "padded",
    name: "Padded",
    url: shopUrl,
    authType: "bearer",
    authSecret: ` ${SHOP_SECRET}\r\n`,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.server.status, "connected");
  assert.equal(getServerBySlug(context.db, "padded")?.authSecret, SHOP_SECRET);

  const replaced = await admin.request("PATCH", "/api/admin/servers/padded", { authSecret: `\t${SHOP_SECRET} ` });
  assert.equal(replaced.status, 200);
  assert.equal(replaced.body.server.status, "connected");
  assert.equal(getServerBySlug(context.db, "padded")?.authSecret, SHOP_SECRET);

  const blankCreate = await admin.request("POST", "/api/admin/servers", {
    slug: "blank",
    name: "Blank",
    url: shopUrl,
    authType: "bearer",
    authSecret: "   ",
  });
  assert.equal(blankCreate.status, 400);
  assert.equal(getServerBySlug(context.db, "blank"), undefined);

  const blankReplace = await admin.request("PATCH", "/api/admin/servers/padded", { authSecret: " \n " });
  assert.equal(blankReplace.status, 400);
  assert.equal(getServerBySlug(context.db, "padded")?.authSecret, SHOP_SECRET);

  assert.equal((await admin.request("DELETE", "/api/admin/servers/padded")).status, 204);
});

test("admin invites a member who sets their own password", async () => {
  const invite = await admin.request("POST", "/api/admin/users", { email: "member@test.dev", name: "Member" });
  assert.equal(invite.status, 201);
  memberId = invite.body.user.id;

  const accepted = await member.request("POST", "/api/auth/invite/accept", {
    token: invite.body.inviteToken,
    password: "member-password-123",
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.user.role, "member");

  // Invite tokens are single use.
  const reused = await new Browser().request("POST", "/api/auth/invite/accept", {
    token: invite.body.inviteToken,
    password: "another-password-123",
  });
  assert.equal(reused.status, 400);
});

test("members cannot use admin endpoints", async () => {
  assert.equal((await member.request("GET", "/api/admin/servers")).status, 403);
  assert.equal((await member.request("GET", "/api/admin/audit")).status, 403);
  assert.equal((await member.request("POST", "/api/admin/users", { email: "y@test.dev", name: "Y" })).status, 403);
});

test("team management is admin-only, leaks no secrets, and re-issued invites replace old ones", async () => {
  // Every endpoint the Team page uses is rejected for members server-side.
  assert.equal((await member.request("GET", "/api/admin/users")).status, 403);
  assert.equal((await member.request("PATCH", `/api/admin/users/${memberId}`, { role: "admin" })).status, 403);
  assert.equal((await member.request("POST", `/api/admin/users/${memberId}/invite`)).status, 403);
  assert.equal((await member.request("POST", `/api/admin/users/${memberId}/keys`, { name: "x" })).status, 403);
  assert.equal((await member.request("DELETE", `/api/admin/users/${memberId}`)).status, 403);
  assert.equal((await member.request("DELETE", "/api/admin/keys/1")).status, 403);

  const first = await admin.request("POST", "/api/admin/users", { email: "pending@test.dev", name: "Pending", role: "member" });
  const second = await admin.request("POST", `/api/admin/users/${first.body.user.id}/invite`);
  assert.equal(second.status, 200);

  const users = await admin.request("GET", "/api/admin/users");
  const pending = users.body.users.find((u: { id: number }) => u.id === first.body.user.id);
  const active = users.body.users.find((u: { id: number }) => u.id === memberId);
  assert.deepEqual([pending.hasPassword, pending.invitePending], [false, true]);
  assert.deepEqual([active.hasPassword, active.invitePending], [true, false]);
  for (const secret of [first.body.inviteToken, second.body.inviteToken, "member-password-123"]) {
    assert.ok(!users.raw.includes(secret));
  }
  assert.ok(!/password_?hash|invite_?token|scrypt/i.test(users.raw));

  // Only the newest invite link works.
  const stale = await new Browser().request("POST", "/api/auth/invite/accept", {
    token: first.body.inviteToken,
    password: "pending-password-123",
  });
  assert.equal(stale.status, 400);

  assert.equal((await admin.request("DELETE", `/api/admin/users/${first.body.user.id}`)).status, 204);
});

test("admin-only tools are hidden from members and rejected when called", async () => {
  const memberTools = await member.request("GET", "/api/tools");
  assert.deepEqual(memberTools.body.tools.map((t: { name: string }) => t.name), ["shop__list_orders"]);

  const adminTools = await admin.request("GET", "/api/tools");
  assert.equal(adminTools.body.tools.length, 2);

  const { body } = await member.request("POST", "/api/me/keys", { name: "cursor" });
  const rest = await fetch(`${baseUrl}/api/mcp/servers/shop/tools`, {
    headers: { Authorization: `Bearer ${body.key}` },
  });
  assert.deepEqual(((await rest.json()) as { tools: Array<{ name: string }> }).tools.map((t) => t.name), ["list_orders"]);

  const client = await mcp(body.key);
  const denied = (await client.callTool({ name: "shop__create_product", arguments: {} })) as CallToolResult;
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied.content), /requires the admin role/);
  await client.close();

  const adminKey = (await admin.request("POST", "/api/me/keys", { name: "cli" })).body.key;
  const adminClient = await mcp(adminKey);
  const allowed = (await adminClient.callTool({ name: "shop__create_product", arguments: {} })) as CallToolResult;
  assert.notEqual(allowed.isError, true);
  await adminClient.close();
});

test("every role sees server status without URLs, counting only allowed tools", async () => {
  assert.equal((await new Browser().request("GET", "/api/servers")).status, 401);

  const memberView = await member.request("GET", "/api/servers");
  assert.equal(memberView.status, 200);
  assert.deepEqual(memberView.body.servers.map((s: { slug: string; status: string; toolCount: number }) => [s.slug, s.status, s.toolCount]), [["shop", "connected", 1]]);
  assert.ok(!memberView.raw.includes(shopUrl), "upstream URL is not exposed");
  assert.equal(memberView.body.servers[0].url, undefined);

  const adminView = await admin.request("GET", "/api/servers");
  assert.equal(adminView.body.servers[0].toolCount, 2);
});

test("members read only their own audit entries, newest first, with a cursor", async () => {
  const mine = await member.request("GET", "/api/me/audit?userId=1");
  assert.equal(mine.status, 200);
  assert.ok(mine.body.entries.length >= 1);
  assert.ok(mine.body.entries.every((e: { userId: number }) => e.userId === memberId), "userId in the query is ignored");

  const all = (await admin.request("GET", "/api/admin/audit")).body.entries as Array<{ id: number }>;
  assert.ok(all.length >= 2);
  const firstPage = await admin.request("GET", "/api/admin/audit?limit=1");
  assert.deepEqual(firstPage.body.entries.map((e: { id: number }) => e.id), [all[0].id]);
  const nextPage = await admin.request("GET", `/api/admin/audit?limit=1&beforeId=${all[0].id}`);
  assert.deepEqual(nextPage.body.entries.map((e: { id: number }) => e.id), [all[1].id]);

  const bySource = await admin.request("GET", "/api/admin/audit?source=mcp");
  assert.ok(bySource.body.entries.every((e: { source: string }) => e.source === "mcp"));
  assert.equal((await admin.request("GET", "/api/admin/audit?source=ftp")).status, 400);
});

test("members manage only their own keys; revocation takes effect immediately", async () => {
  const issued = await member.request("POST", "/api/me/keys", { name: "laptop" });
  assert.equal(issued.status, 201);
  assert.match(issued.body.key, /^ajay_/);

  const listed = await member.request("GET", "/api/me/keys");
  assert.ok(!listed.raw.includes(issued.body.key), "plaintext key is shown only once");

  const adminKeys = (await admin.request("GET", "/api/me/keys")).body.keys;
  assert.equal((await member.request("DELETE", `/api/me/keys/${adminKeys[0].id}`)).status, 404);

  const client = await mcp(issued.body.key);
  assert.equal((await member.request("DELETE", `/api/me/keys/${issued.body.summary.id}`)).status, 200);
  await assert.rejects(client.listTools());
  await client.close().catch(() => {});
});

test("admin issues and revokes a member's key", async () => {
  const issued = await admin.request("POST", `/api/admin/users/${memberId}/keys`, { name: "issued-by-admin" });
  assert.equal(issued.status, 201);

  const users = await admin.request("GET", "/api/admin/users");
  const memberRow = users.body.users.find((u: { id: number }) => u.id === memberId);
  assert.ok(memberRow.keys.some((k: { name: string }) => k.name === "issued-by-admin"));
  assert.ok(!users.raw.includes(issued.body.key));

  const revoked = await admin.request("DELETE", `/api/admin/keys/${issued.body.summary.id}`);
  assert.ok(revoked.body.key.revokedAt);
  await assert.rejects(mcp(issued.body.key));
});

test("disabling and removing a server updates every user's tool list", async () => {
  await admin.request("PATCH", "/api/admin/servers/shop", { enabled: false });
  assert.deepEqual((await member.request("GET", "/api/tools")).body.tools, []);
  const disabled = await admin.request("GET", "/api/admin/servers");
  assert.equal(disabled.body.servers[0].status, "disabled");

  await admin.request("PATCH", "/api/admin/servers/shop", { enabled: true });
  assert.equal((await member.request("GET", "/api/tools")).body.tools.length, 1);

  assert.equal((await admin.request("DELETE", "/api/admin/servers/shop")).status, 204);
  assert.deepEqual((await admin.request("GET", "/api/admin/servers")).body.servers, []);
});

test("audit log is filterable by user and outcome", async () => {
  const denied = await admin.request("GET", `/api/admin/audit?userId=${memberId}&outcome=denied`);

  assert.ok(denied.body.entries.length >= 2);
  assert.ok(denied.body.entries.every((e: { userEmail: string; outcome: string }) => e.userEmail === "member@test.dev" && e.outcome === "denied"));
  assert.ok(denied.body.entries.some((e: { tool: string }) => e.tool === "create_product"));

  // Entries record metadata only: never arguments, results or credentials.
  const all = await admin.request("GET", "/api/admin/audit");
  assert.ok(!all.raw.includes(SHOP_SECRET));
  for (const entry of all.body.entries) {
    assert.deepEqual(
      Object.keys(entry).sort(),
      ["durationMs", "error", "id", "outcome", "serverSlug", "source", "startedAt", "tool", "userEmail", "userId"],
    );
  }

  const success = await admin.request("GET", "/api/admin/audit?outcome=success");
  assert.ok(success.body.entries.some((e: { userEmail: string; tool: string }) => e.userEmail === ADMIN.email && e.tool === "create_product"));
});

test("the last admin cannot be demoted; admins cannot remove themselves", async () => {
  const me = (await admin.request("GET", "/api/me")).body.user;

  assert.equal((await admin.request("PATCH", `/api/admin/users/${me.id}`, { role: "member" })).status, 409);
  assert.equal((await admin.request("DELETE", `/api/admin/users/${me.id}`)).status, 409);

  // Promoting the member takes effect on their existing session.
  await admin.request("PATCH", `/api/admin/users/${memberId}`, { role: "admin" });
  assert.equal((await member.request("GET", "/api/admin/servers")).status, 200);
});

test("removing a user ends their session", async () => {
  assert.equal((await admin.request("DELETE", `/api/admin/users/${memberId}`)).status, 204);
  assert.equal((await member.request("GET", "/api/me")).status, 401);
});

test("logout ends the session", async () => {
  assert.equal((await admin.request("POST", "/api/auth/logout")).status, 204);
  assert.equal((await admin.request("GET", "/api/me")).status, 401);
});
