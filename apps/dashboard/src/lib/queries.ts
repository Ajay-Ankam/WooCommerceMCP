import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, isApiError, queryString } from "./api";
import type {
  AdminServer,
  ApiKeySummary,
  IssuedKey,
  AuditEntry,
  AuditQuery,
  ActionDecision,
  ChatResult,
  ChatStatus,
  ChatUnavailable,
  Conversation,
  ConversationSummary,
  InviteResult,
  Role,
  ServerInput,
  ServerPatch,
  ServerSummary,
  ToolInfo,
  User,
  UserDetails,
} from "./types";

// One place for cache keys, so mutations can invalidate precisely.
export const keys = {
  me: ["me"] as const,
  servers: ["servers"] as const,
  adminServers: ["admin", "servers"] as const,
  myKeys: ["me", "keys"] as const,
  users: ["admin", "users"] as const,
  chatStatus: ["chat", "status"] as const,
  conversations: ["chat", "conversations"] as const,
  conversation: (id: number) => ["chat", "conversations", id] as const,
  tools: ["tools"] as const,
  audit: (scope: "mine" | "all", query: AuditQuery) => ["audit", scope, query] as const,
};

// ---- Session ---------------------------------------------------------------

// null means "not logged in"; any other failure surfaces as an error.
export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return (await api<{ user: User }>("/api/me")).user;
      } catch (error) {
        if (isApiError(error, 401)) {
          return null;
        }
        throw error;
      }
    },
    staleTime: 5 * 60_000,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; password: string }) =>
      api<{ user: User }>("/api/auth/login", { method: "POST", body: input }),
    onSuccess: ({ user }) => {
      queryClient.clear();
      queryClient.setQueryData(keys.me, user);
    },
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { token: string; password: string }) =>
      api<{ user: User }>("/api/auth/invite/accept", { method: "POST", body: input }),
    onSuccess: ({ user }) => {
      queryClient.clear();
      queryClient.setQueryData(keys.me, user);
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api<void>("/api/auth/logout", { method: "POST" }),
    // Drop every cached response either way, so nothing leaks to the next user.
    onSettled: () => {
      queryClient.clear();
      queryClient.setQueryData(keys.me, null);
    },
  });
}

// ---- API keys --------------------------------------------------------------

export function useMyKeys() {
  return useQuery({
    queryKey: keys.myKeys,
    queryFn: async () => (await api<{ keys: ApiKeySummary[] }>("/api/me/keys")).keys,
  });
}

// The plaintext key exists only in this mutation's result. gcTime 0 drops it
// from the mutation cache as soon as the dialog resets it; it is never put in
// the query cache or browser storage.
export function useCreateKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (name: string) => api<IssuedKey>("/api/me/keys", { method: "POST", body: { name } }),
    gcTime: 0,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.myKeys }),
  });
}

export function useRevokeKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api<{ key: ApiKeySummary }>(`/api/me/keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.myKeys }),
  });
}

// ---- Team (admin only) -----------------------------------------------------

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: keys.users,
    queryFn: async () => (await api<{ users: UserDetails[] }>("/api/admin/users")).users,
    enabled,
  });
}

function useInvalidateUsers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: keys.users });
}

// Like a new API key, the invite token lives only in the mutation result.
export function useInviteUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (input: { email: string; name: string; role: Role }) =>
      api<InviteResult>("/api/admin/users", { method: "POST", body: input }),
    gcTime: 0,
    onSuccess: invalidate,
  });
}

export function useReissueInvite() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (id: number) => api<InviteResult>(`/api/admin/users/${id}/invite`, { method: "POST" }),
    gcTime: 0,
    onSuccess: invalidate,
  });
}

export function useUpdateRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) =>
      api<{ user: User }>(`/api/admin/users/${id}`, { method: "PATCH", body: { role } }),
    // Refresh `me` too, in case an admin changed their own role.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.users }),
        queryClient.invalidateQueries({ queryKey: keys.me, exact: true }),
      ]),
  });
}

export function useRemoveUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/admin/users/${id}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useAdminRevokeKey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api<{ key: ApiKeySummary }>(`/api/admin/keys/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.users }),
        queryClient.invalidateQueries({ queryKey: keys.myKeys }),
      ]),
  });
}

// ---- Chat ------------------------------------------------------------------

// A turn can take several tool rounds plus model calls, far beyond the
// default request timeout.
const CHAT_TIMEOUT_MS = 180_000;

export function useChatStatus() {
  return useQuery({
    queryKey: keys.chatStatus,
    queryFn: () => api<ChatStatus>("/api/chat/status"),
    staleTime: 5 * 60_000,
  });
}

export function useConversations() {
  return useQuery({
    queryKey: keys.conversations,
    queryFn: async () => (await api<{ conversations: ConversationSummary[] }>("/api/chat/conversations")).conversations,
  });
}

export function useConversation(id: number | undefined) {
  return useQuery({
    queryKey: keys.conversation(id ?? 0),
    queryFn: ({ signal }) => api<Conversation>(`/api/chat/conversations/${id}`, { signal }),
    enabled: id !== undefined,
  });
}

// The stored conversation is the source of truth; refetch it after every turn
// so tool results and pending actions render exactly as the gateway saved them.
function useRefreshChat() {
  const queryClient = useQueryClient();

  return (conversationId: number | undefined) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.conversations }),
      conversationId !== undefined && queryClient.invalidateQueries({ queryKey: keys.conversation(conversationId) }),
    ]);
}

// Retrying would repeat a model call (and spend quota), so failures surface instead.
export function useSendMessage() {
  const refresh = useRefreshChat();

  return useMutation({
    mutationFn: (input: { conversationId?: number; message: string }) =>
      api<ChatResult>("/api/chat", { method: "POST", body: input, timeoutMs: CHAT_TIMEOUT_MS }),
    onSettled: (data, error, input) =>
      refresh(data?.conversationId ?? chatErrorConversation(error) ?? input.conversationId),
  });
}

export function useDecideAction() {
  const refresh = useRefreshChat();

  return useMutation({
    mutationFn: ({ conversationId, actionId, decision }: { conversationId: number; actionId: string; decision: ActionDecision }) =>
      api<ChatResult>(`/api/chat/conversations/${conversationId}/actions/${encodeURIComponent(actionId)}`, {
        method: "POST",
        body: { decision },
        timeoutMs: CHAT_TIMEOUT_MS,
      }),
    onSettled: (_data, _error, input) => refresh(input.conversationId),
  });
}

export function useDeleteConversation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => api<void>(`/api/chat/conversations/${id}`, { method: "DELETE" }),
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: keys.conversation(id) });
      return queryClient.invalidateQueries({ queryKey: keys.conversations });
    },
  });
}

// A 503 LLM_UNAVAILABLE still created (or continued) a conversation.
export function chatErrorConversation(error: unknown): number | undefined {
  const body = isApiError(error) ? (error.body as Partial<ChatUnavailable> | undefined) : undefined;
  return typeof body?.conversationId === "number" ? body.conversationId : undefined;
}

// ---- Servers, tools, audit -------------------------------------------------

export function useServers() {
  return useQuery({
    queryKey: keys.servers,
    queryFn: async () => (await api<{ servers: ServerSummary[] }>("/api/servers")).servers,
    // Mirrors the gateway's background status probe (STATUS_REFRESH_MS).
    refetchInterval: 15_000,
  });
}

// Full registry incl. URLs, probe errors and tool schemas (admin only).
export function useAdminServers(enabled = true) {
  return useQuery({
    queryKey: keys.adminServers,
    queryFn: async () => (await api<{ servers: AdminServer[] }>("/api/admin/servers")).servers,
    refetchInterval: 15_000,
    enabled,
  });
}

// Every server change can alter status counts and the tools users may call.
function useInvalidateServers() {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.adminServers }),
      queryClient.invalidateQueries({ queryKey: keys.servers }),
      queryClient.invalidateQueries({ queryKey: keys.tools }),
    ]);
}

export function useCreateServer() {
  const invalidate = useInvalidateServers();

  return useMutation({
    // Registration probes the upstream first, which can take the full timeout.
    mutationFn: async (input: ServerInput) =>
      (await api<{ server: AdminServer }>("/api/admin/servers", { method: "POST", body: input, timeoutMs: 30_000 })).server,
    onSuccess: invalidate,
  });
}

export function useUpdateServer() {
  const invalidate = useInvalidateServers();

  return useMutation({
    mutationFn: async ({ slug, patch }: { slug: string; patch: ServerPatch }) =>
      (
        await api<{ server: AdminServer }>(`/api/admin/servers/${encodeURIComponent(slug)}`, {
          method: "PATCH",
          body: patch,
          timeoutMs: 30_000,
        })
      ).server,
    onSuccess: invalidate,
  });
}

export function useDeleteServer() {
  const invalidate = useInvalidateServers();

  return useMutation({
    mutationFn: (slug: string) => api<void>(`/api/admin/servers/${encodeURIComponent(slug)}`, { method: "DELETE" }),
    onSuccess: invalidate,
  });
}

export function useTools() {
  return useQuery({
    queryKey: keys.tools,
    queryFn: async () => (await api<{ tools: ToolInfo[] }>("/api/tools")).tools,
  });
}

export const AUDIT_PAGE_SIZE = 50;

// Keyset pagination: each page asks for entries older than the last id seen.
export function useAuditLog(scope: "mine" | "all", filters: Omit<AuditQuery, "limit" | "beforeId">) {
  const path = scope === "all" ? "/api/admin/audit" : "/api/me/audit";

  return useInfiniteQuery({
    queryKey: [...keys.audit(scope, filters), "pages"],
    initialPageParam: undefined as number | undefined,
    queryFn: async ({ pageParam, signal }) =>
      (
        await api<{ entries: AuditEntry[] }>(
          `${path}${queryString({ ...filters, limit: AUDIT_PAGE_SIZE, beforeId: pageParam })}`,
          { signal },
        )
      ).entries,
    getNextPageParam: (last) => (last.length < AUDIT_PAGE_SIZE ? undefined : last[last.length - 1]?.id),
  });
}

// Admins read the team-wide log; members only their own calls.
export function useAudit(scope: "mine" | "all", query: AuditQuery) {
  const path = scope === "all" ? "/api/admin/audit" : "/api/me/audit";

  return useQuery({
    queryKey: keys.audit(scope, query),
    queryFn: async () => (await api<{ entries: AuditEntry[] }>(`${path}${queryString(query)}`)).entries,
  });
}
