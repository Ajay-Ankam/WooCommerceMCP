// Operator CLI for bootstrapping before the dashboard exists, or for
// recovery via `kubectl exec`. Plaintext API keys are printed exactly once.
//
//   issue-key   --email a@x.dev [--name "User A"] [--role admin|member] [--key-name cli]
//   revoke-key  --id 3
//   add-server  --slug utility --name Utility --url http://.../mcp [--auth bearer --secret-env VAR]
//   enable-server / disable-server --slug utility
import { parseArgs } from "node:util";

import { env } from "../config/env.js";
import { openDatabase } from "../db/database.js";
import {
  createServer,
  setServerEnabled,
  type AuthType,
} from "../db/servers.js";
import {
  createUser,
  findUserByEmail,
  issueApiKey,
  revokeApiKey,
  type Role,
} from "../db/users.js";

const [command, ...rest] = process.argv.slice(2);

const { values } = parseArgs({
  args: rest,
  options: {
    email: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "member" },
    "key-name": { type: "string", default: "cli" },
    id: { type: "string" },
    slug: { type: "string" },
    url: { type: "string" },
    auth: { type: "string", default: "none" },
    header: { type: "string" },
    // Name of an environment variable holding the upstream credential, so
    // the secret never appears in shell history or process listings.
    "secret-env": { type: "string" },
  },
});

function required(name: keyof typeof values): string {
  const value = values[name];

  if (typeof value !== "string" || !value) {
    throw new Error(`--${name} is required for ${command}`);
  }

  return value;
}

const db = openDatabase(env.GATEWAY_DB_PATH);

switch (command) {
  case "issue-key": {
    const email = required("email");
    const role = values.role as Role;

    if (role !== "admin" && role !== "member") {
      throw new Error("--role must be admin or member");
    }

    const user =
      findUserByEmail(db, email) ??
      createUser(db, { email, name: values.name ?? email, role });
    const { key, summary } = issueApiKey(db, user.id, values["key-name"]!);

    console.log(`User ${user.email} (${user.role}), key id ${summary.id}`);
    console.log(key);
    break;
  }

  case "revoke-key": {
    const revoked = revokeApiKey(db, Number(required("id")));
    console.log(revoked ? "Key revoked" : "Key not found or already revoked");
    break;
  }

  case "add-server": {
    const secretEnv = values["secret-env"];
    const server = createServer(db, {
      slug: required("slug"),
      name: required("name"),
      url: required("url"),
      authType: values.auth as AuthType,
      authHeaderName: values.header ?? null,
      authSecret: secretEnv ? process.env[secretEnv] ?? null : null,
    });

    console.log(`Registered server ${server.slug} (${server.url})`);
    break;
  }

  case "enable-server":
  case "disable-server": {
    const enabled = command === "enable-server";
    const changed = setServerEnabled(db, required("slug"), enabled);
    console.log(changed ? `Server ${enabled ? "enabled" : "disabled"}` : "Server not found");
    break;
  }

  default:
    console.error(
      "Usage: admin <issue-key|revoke-key|add-server|enable-server|disable-server> [options]",
    );
    process.exitCode = 1;
}

db.close();
