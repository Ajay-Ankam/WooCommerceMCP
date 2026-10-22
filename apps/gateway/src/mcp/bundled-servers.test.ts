import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createGatewayContext } from "../context.js";
import { openDatabase } from "../db/database.js";
import {
  createServer,
  deleteServer,
  getServerBySlug,
  listServers,
  updateServer,
} from "../db/servers.js";
import { parseBundledServers, reconcileBundledServers } from "./bundled-servers.js";

const CONFIG = JSON.stringify([
  {
    slug: "woocommerce",
    name: "WooCommerce Store",
    url: "http://ajay-mcp-woocommerce.ajay-store.svc.cluster.local:3001/mcp",
    authType: "bearer",
    credentialEnv: "BUNDLED_WOOCOMMERCE_TOKEN",
    adminOnlyTools: ["create_product", "update_order_status"],
  },
  {
    slug: "utility",
    name: "Utility",
    url: "http://ajay-mcp-utility.ajay-store.svc.cluster.local:3002/mcp",
    authType: "bearer",
    credentialEnv: "BUNDLED_UTILITY_TOKEN",
  },
  {
    slug: "analytics",
    name: "Sales Analytics",
    url: "http://ajay-mcp-analytics.ajay-store.svc.cluster.local:3002/mcp",
    authType: "bearer",
    credentialEnv: "BUNDLED_ANALYTICS_TOKEN",
  },
]);

const ENV = {
  BUNDLED_WOOCOMMERCE_TOKEN: "woo-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  BUNDLED_UTILITY_TOKEN: " utility-token-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\n",
  BUNDLED_ANALYTICS_TOKEN: "analytics-token-cccccccccccccccccccccccccccc",
};

const bundled = (env: NodeJS.ProcessEnv = ENV) => parseBundledServers(CONFIG, env);

test("fresh database: registers all bundled servers with in-cluster URLs", () => {
  const db = openDatabase(":memory:");
  const result = reconcileBundledServers(db, bundled());

  assert.deepEqual(result, { created: ["woocommerce", "utility", "analytics"], updated: [], unchanged: [] });

  const woo = getServerBySlug(db, "woocommerce")!;
  assert.equal(woo.url, "http://ajay-mcp-woocommerce.ajay-store.svc.cluster.local:3001/mcp");
  assert.equal(woo.authType, "bearer");
  assert.equal(woo.authSecret, ENV.BUNDLED_WOOCOMMERCE_TOKEN);
  assert.equal(woo.enabled, true);
  assert.deepEqual(woo.adminOnlyTools, ["create_product", "update_order_status"]);
  // Credentials are trimmed like dashboard input.
  assert.equal(getServerBySlug(db, "utility")!.authSecret, ENV.BUNDLED_UTILITY_TOKEN.trim());
});

test("restart is idempotent: nothing is rewritten when configuration is unchanged", () => {
  const db = openDatabase(":memory:");
  reconcileBundledServers(db, bundled());
  const before = listServers(db);

  const result = reconcileBundledServers(db, bundled());

  assert.deepEqual(result, { created: [], updated: [], unchanged: ["woocommerce", "utility", "analytics"] });
  assert.deepEqual(listServers(db), before);
});

test("credential rotation updates the stored credential and keeps admin settings", () => {
  const db = openDatabase(":memory:");
  reconcileBundledServers(db, bundled());
  updateServer(db, "utility", { name: "Calculator", enabled: false, adminOnlyTools: ["convert_currency"] });

  const rotated = bundled({ ...ENV, BUNDLED_UTILITY_TOKEN: "rotated-utility-token-dddddddddddddddddddd" });
  const result = reconcileBundledServers(db, rotated);

  assert.deepEqual(result.updated, ["utility"]);
  const utility = getServerBySlug(db, "utility")!;
  assert.equal(utility.authSecret, "rotated-utility-token-dddddddddddddddddddd");
  assert.equal(utility.name, "Calculator");
  assert.equal(utility.enabled, false);
  assert.deepEqual(utility.adminOnlyTools, ["convert_currency"]);
});

test("disabled state and admin-only tools survive restarts and URL changes", () => {
  const db = openDatabase(":memory:");
  reconcileBundledServers(db, bundled());
  updateServer(db, "woocommerce", { enabled: false, adminOnlyTools: ["create_product"] });

  const moved = parseBundledServers(
    CONFIG.replace("ajay-mcp-woocommerce.ajay-store.svc.cluster.local:3001", "woo.example.internal:8080"),
    ENV,
  );
  reconcileBundledServers(db, moved);

  const woo = getServerBySlug(db, "woocommerce")!;
  assert.equal(woo.url, "http://woo.example.internal:8080/mcp");
  assert.equal(woo.enabled, false);
  assert.deepEqual(woo.adminOnlyTools, ["create_product"]);
});

test("admin-added servers are never touched", () => {
  const db = openDatabase(":memory:");
  createServer(db, { slug: "github", name: "GitHub", url: "https://mcp.example.com/mcp", authType: "bearer", authSecret: "gh-secret" });
  const github = getServerBySlug(db, "github");

  reconcileBundledServers(db, bundled());

  assert.deepEqual(getServerBySlug(db, "github"), github);
  assert.equal(listServers(db).length, 4);
});

test("a deleted bundled server is registered again on the next start", () => {
  const db = openDatabase(":memory:");
  reconcileBundledServers(db, bundled());
  deleteServer(db, "analytics");

  const result = reconcileBundledServers(db, bundled());

  assert.deepEqual(result.created, ["analytics"]);
  assert.ok(getServerBySlug(db, "analytics"));
});

test("existing database file: port-forward registrations are moved to cluster URLs, data kept", () => {
  const dir = mkdtempSync(join(tmpdir(), "ajay-bundled-"));
  const path = join(dir, "gateway.db");

  try {
    // A database written before BUNDLED_SERVERS existed, like a local dev DB.
    const old = openDatabase(path);
    createServer(old, { slug: "woocommerce", name: "WooCommerce Store", url: "http://127.0.0.1:3101/mcp", authType: "bearer", authSecret: "old-woo", adminOnlyTools: ["create_product"] });
    createServer(old, { slug: "utility", name: "Utility", url: "http://127.0.0.1:3102/mcp", authType: "bearer", authSecret: "old-utility", enabled: false });
    createServer(old, { slug: "custom", name: "Custom", url: "http://127.0.0.1:9999/mcp", authType: "none" });
    old.prepare("INSERT INTO users (email, name, role, created_at) VALUES ('a@test.dev', 'A', 'admin', '2026-10-21T00:00:00Z')").run();
    old.close();

    const context = createGatewayContext({ dbPath: path, upstreamTimeoutMs: 500, bundledServers: bundled() });

    try {
      assert.deepEqual(context.bundledReconcile, { created: ["analytics"], updated: ["woocommerce", "utility"], unchanged: [] });
      assert.deepEqual([...context.bundledSlugs], ["woocommerce", "utility", "analytics"]);

      const woo = getServerBySlug(context.db, "woocommerce")!;
      assert.match(woo.url, /svc\.cluster\.local/);
      assert.deepEqual(woo.adminOnlyTools, ["create_product"]);
      assert.equal(getServerBySlug(context.db, "utility")!.enabled, false);
      assert.equal(getServerBySlug(context.db, "custom")!.url, "http://127.0.0.1:9999/mcp");
      assert.equal((context.db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number }).n, 1);
    } finally {
      context.db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("configuration errors name the problem without revealing credentials", () => {
  assert.deepEqual(parseBundledServers(undefined), []);
  assert.deepEqual(parseBundledServers("  "), []);
  assert.throws(() => parseBundledServers("{not json"), /not valid JSON/);
  assert.throws(() => parseBundledServers(CONFIG, { ...ENV, BUNDLED_UTILITY_TOKEN: "   " }), /BUNDLED_UTILITY_TOKEN is missing or empty/);
  assert.throws(
    () => parseBundledServers(JSON.stringify([{ slug: "x", name: "X", url: "http://x/mcp", authType: "bearer" }])),
    /needs credentialEnv/,
  );
  assert.throws(
    () => parseBundledServers(JSON.stringify([{ slug: "Bad_Slug", name: "X", url: "http://x/mcp" }])),
    /BUNDLED_SERVERS is invalid/,
  );
  assert.throws(
    () => parseBundledServers(JSON.stringify([{ slug: "x", name: "X", url: "http://x/mcp" }, { slug: "x", name: "Y", url: "http://y/mcp" }])),
    /twice/,
  );
  // Inline secrets are rejected: credentials must come from the environment.
  assert.throws(
    () => parseBundledServers(JSON.stringify([{ slug: "x", name: "X", url: "http://x/mcp", authType: "bearer", authSecret: "inline" }])),
    /invalid/,
  );

  try {
    parseBundledServers(CONFIG, { ...ENV, BUNDLED_ANALYTICS_TOKEN: "" });
  } catch (error) {
    assert.ok(!String(error).includes(ENV.BUNDLED_WOOCOMMERCE_TOKEN));
  }
});
