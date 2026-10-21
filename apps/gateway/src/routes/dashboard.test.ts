import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import type { Server as HttpServer } from "node:http";

import { createApp } from "../app.js";
import { createGatewayContext, type GatewayContext } from "../context.js";
import { close, listen } from "../test-support.js";

let context: GatewayContext;
let server: HttpServer;
let baseUrl: string;
let dir: string;

before(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "ajay-dashboard-"));
  mkdirSync(path.join(dir, "assets"));
  writeFileSync(path.join(dir, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(path.join(dir, "assets", "app-abc123.js"), "console.log(1)");

  context = createGatewayContext({ dbPath: ":memory:", upstreamTimeoutMs: 1000 });
  ({ server, url: baseUrl } = await listen(createApp(context, { dashboardDir: dir })));
});

after(async () => {
  await context.upstreams.close();
  await close(server);
  rmSync(dir, { recursive: true, force: true });
});

test("serves fingerprinted assets with long-lived caching", async () => {
  const response = await fetch(`${baseUrl}/assets/app-abc123.js`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /immutable/);
});

test("client-side routes fall back to index.html with security headers", async () => {
  for (const route of ["/", "/servers", "/invite/some-token"]) {
    const response = await fetch(`${baseUrl}${route}`);

    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /id=root/);
    assert.equal(response.headers.get("cache-control"), "no-cache");
    assert.match(response.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'/);
  }
});

test("API, MCP and health paths are never shadowed by the SPA", async () => {
  const api = await fetch(`${baseUrl}/api/unknown`);
  assert.equal(api.status, 404);
  assert.match(api.headers.get("content-type") ?? "", /json/);

  assert.equal((await fetch(`${baseUrl}/api/me`)).status, 401);
  assert.equal((await fetch(`${baseUrl}/mcp`)).status, 405);
  assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
});

test("a missing build fails fast instead of serving 404s", () => {
  assert.throws(() => createApp(context, { dashboardDir: path.join(dir, "nope") }), /no index\.html/);
});
