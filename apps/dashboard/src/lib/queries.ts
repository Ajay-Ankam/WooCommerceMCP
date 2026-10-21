import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, isApiError, queryString } from "./api";
import type { AuditEntry, AuditQuery, ServerSummary, ToolInfo, User } from "./types";

// One place for cache keys, so mutations can invalidate precisely.
export const keys = {
  me: ["me"] as const,
  servers: ["servers"] as const,
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

// ---- Servers, tools, audit -------------------------------------------------

export function useServers() {
  return useQuery({
    queryKey: keys.servers,
    queryFn: async () => (await api<{ servers: ServerSummary[] }>("/api/servers")).servers,
    // Mirrors the gateway's background status probe (STATUS_REFRESH_MS).
    refetchInterval: 15_000,
  });
}

export function useTools() {
  return useQuery({
    queryKey: keys.tools,
    queryFn: async () => (await api<{ tools: ToolInfo[] }>("/api/tools")).tools,
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
