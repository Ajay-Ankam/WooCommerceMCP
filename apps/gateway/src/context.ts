import { openDatabase, type Database } from "./db/database.js";
import { createServer, listServers } from "./db/servers.js";
import { countUsers, createUser, setPassword } from "./db/users.js";
import { GatewayTools } from "./mcp/gateway-tools.js";
import { UpstreamManager } from "./mcp/upstream-manager.js";

export interface AuthSettings {
  sessionTtlHours: number;
  inviteTtlHours: number;
  cookieSecure: boolean;
}

export interface GatewayContext {
  db: Database;
  upstreams: UpstreamManager;
  tools: GatewayTools;
  auth: AuthSettings;
}

export interface GatewayContextOptions {
  dbPath: string;
  upstreamTimeoutMs: number;
  auth?: Partial<AuthSettings>;
  seed?: {
    woocommerceUrl?: string;
    woocommerceToken?: string;
    adminEmail?: string;
    adminPassword?: string;
  };
}

// WooCommerce write tools are restricted to admins by default; admins can
// change this per server from the dashboard.
const WOOCOMMERCE_ADMIN_ONLY_TOOLS = ["create_product", "update_order_status"];

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
      adminOnlyTools: WOOCOMMERCE_ADMIN_ONLY_TOOLS,
    });
  }

  if (countUsers(db) === 0 && options.adminEmail) {
    const admin = createUser(db, {
      email: options.adminEmail,
      name: "Administrator",
      role: "admin",
    });

    if (options.adminPassword) {
      setPassword(db, admin.id, options.adminPassword);
    }
  }
}

export function createGatewayContext(
  options: GatewayContextOptions,
): GatewayContext {
  const db = openDatabase(options.dbPath);

  seed(db, options.seed);

  const upstreams = new UpstreamManager(db, options.upstreamTimeoutMs);
  const tools = new GatewayTools(db, upstreams);

  return {
    db,
    upstreams,
    tools,
    auth: {
      sessionTtlHours: options.auth?.sessionTtlHours ?? 12,
      inviteTtlHours: options.auth?.inviteTtlHours ?? 72,
      cookieSecure: options.auth?.cookieSecure ?? false,
    },
  };
}
