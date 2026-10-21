import { Navigate, Outlet, useLocation } from "react-router";

import { ErrorState, FullScreenLoader } from "@/components/page";
import { useMe } from "@/lib/queries";
import type { User } from "@/lib/types";

// Only same-site paths are accepted as a post-login target (no open redirect).
export function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return <FullScreenLoader />;
  }

  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <ErrorState error={me.error} onRetry={() => void me.refetch()} />
      </div>
    );
  }

  if (!me.data) {
    const next = location.pathname + location.search;
    return <Navigate to={next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`} replace />;
  }

  return <Outlet />;
}

// Hides admin pages from members. Authorization itself is enforced by the
// gateway on every request; this only keeps the UI honest.
export function RequireAdmin() {
  return useCurrentUser().role === "admin" ? <Outlet /> : <Navigate to="/" replace />;
}

// For components rendered inside RequireAuth, where the user is known.
export function useCurrentUser(): User {
  const { data } = useMe();

  if (!data) {
    throw new Error("useCurrentUser used outside RequireAuth");
  }

  return data;
}

export function useIsAdmin(): boolean {
  return useCurrentUser().role === "admin";
}
