// Mirrors of the gateway's JSON responses (apps/gateway/src). Kept by hand:
// the dashboard only depends on the HTTP contract, not on gateway code.

export type Role = "admin" | "member";

export interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface ApiKeySummary {
  id: number;
  userId: number;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface UserDetails extends User {
  createdAt: string;
  hasPassword: boolean;
  invitePending: boolean;
  keys: ApiKeySummary[];
}

export interface IssuedKey {
  key: string;
  summary: ApiKeySummary;
}

export interface InviteResult {
  user: UserDetails;
  inviteToken: string;
  invitePath: string;
  expiresInHours: number;
}

export type ServerStatus = "connected" | "unreachable" | "disabled" | "pending";

// GET /api/servers (every role; no URLs or probe errors).
export interface ServerSummary {
  slug: string;
  name: string;
  enabled: boolean;
  status: ServerStatus;
  checkedAt: string | null;
  toolCount: number;
}

export type AuthType = "none" | "bearer" | "header";

export interface AdminServerTool {
  name: string;
  exposedName: string;
  description: string;
  inputSchema: JsonSchema;
  adminOnly: boolean;
}

// GET /api/admin/servers (admin only; credentials are never returned).
export interface AdminServer {
  id: number;
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName: string | null;
  hasCredential: boolean;
  enabled: boolean;
  adminOnlyTools: string[];
  createdAt: string;
  updatedAt: string;
  // Bundled with the deployment: URL and credential follow the Helm values.
  managed: boolean;
  status: ServerStatus;
  statusError: string | null;
  checkedAt: string | null;
  tools: AdminServerTool[];
}

// POST /api/admin/servers body. authSecret is write-only.
export interface ServerInput {
  slug: string;
  name: string;
  url: string;
  authType: AuthType;
  authHeaderName?: string | null;
  authSecret?: string | null;
  enabled?: boolean;
  adminOnlyTools?: string[];
}

// PATCH body: omitted fields are unchanged; authSecret undefined keeps the
// stored credential, null clears it, a string replaces it.
export type ServerPatch = Partial<Omit<ServerInput, "slug">>;

export type JsonSchema = Record<string, unknown>;

// GET /api/tools: names are namespaced "<slug>__<tool>".
export interface ToolInfo {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
}

export type AuditOutcome = "success" | "error" | "denied";
export type AuditSource = "mcp" | "rest" | "chat";

export interface AuditEntry {
  id: number;
  userId: number | null;
  userEmail: string | null;
  source: AuditSource;
  serverSlug: string | null;
  tool: string;
  startedAt: string;
  durationMs: number;
  outcome: AuditOutcome;
  error: string | null;
}

export interface AuditQuery {
  limit?: number;
  beforeId?: number;
  userId?: number;
  server?: string;
  outcome?: AuditOutcome;
  source?: AuditSource;
}

// ---- Chat ----------------------------------------------------------------

export interface ChatToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export type ChatMessage =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; toolCalls: ChatToolCall[]; provider: string | null }
  | { role: "tool"; toolCallId: string; name: string; content: string; isError: boolean };

export interface ConversationSummary {
  id: number;
  userId: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}

// A write the agent paused on. Only the decision is ever sent back; the
// gateway runs the arguments it stored, never ones from the browser.
export interface PendingAction {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
}

export type ActionDecision = "approve" | "reject";

export interface Conversation extends ConversationSummary {
  messages: ChatMessage[];
  pendingAction: PendingAction | null;
}

export interface ToolTrace {
  name: string;
  arguments: Record<string, unknown>;
  isError: boolean;
  durationMs: number;
  provider: string;
  deduplicated: boolean;
}

export interface ProviderFailure {
  provider: string;
  model: string;
  kind: string;
  message: string;
}

export interface ChatResult {
  conversationId: number;
  reply: string;
  provider: string;
  model: string;
  toolCalls: ToolTrace[];
  fallbacks: ProviderFailure[];
  incomplete: boolean;
  pendingAction: PendingAction | null;
}

// Body of a 503 LLM_UNAVAILABLE: every provider failed, nothing was invented.
export interface ChatUnavailable {
  conversationId: number;
  failures: ProviderFailure[];
  toolCalls: ToolTrace[];
}

export interface ChatStatus {
  enabled: boolean;
  // Fallback chain in order; provider names and models only, never keys.
  providers: Array<{ provider: string; model: string }>;
}
