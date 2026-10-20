import { openDatabase, type Database } from "./db/database.js";
import { createServer, listServers } from "./db/servers.js";
import { countUsers, createUser } from "./db/users.js";
import { GatewayTools } from "./mcp/gateway-tools.js";
import { UpstreamManager } from "./mcp/upstream-manager.js";

export interface GatewayContext {
  db: Database;
  upstreams: UpstreamManager;
  tools: GatewayTools;
}

export interface GatewayContextOptions {
  dbPath: string;
  upstreamTimeoutMs: number;
  seed?: {
    woocommerceUrl?: string;
    woocommerceToken?: string;
    adminEmail?: string;
  };
}

// First-boot seeding only: once rows exist, the dashboard owns them and
// environment variables never overwrite admin changes.
function seed(db: Database, options: GatewayContextOptions["seed"] = {}) {
  if (
    listServers(db).length === 0 &&
    options.woocommerceUrl &&
    options.woocommerceToken
  ) {
    createServer(db, {
      slug: "woocommerce",
      name: "WooCommerce Store",
      url: options.woocommerceUrl,
      authType: "bearer",
      authSecret: options.woocommerceToken,
    });
  }

  if (countUsers(db) === 0 && options.adminEmail) {
    createUser(db, {
      email: options.adminEmail,
      name: "Administrator",
      role: "admin",
    });
  }
}

export function createGatewayContext(
  options: GatewayContextOptions,
): GatewayContext {
  const db = openDatabase(options.dbPath);

  seed(db, options.seed);

  const upstreams = new UpstreamManager(db, options.upstreamTimeoutMs);
  const tools = new GatewayTools(db, upstreams);

  return { db, upstreams, tools };
}
