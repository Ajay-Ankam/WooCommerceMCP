import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";

import { RequireAdmin, RequireAuth } from "@/auth/guards";
import { AppShell } from "@/components/app-shell";
import { FullScreenLoader } from "@/components/page";

// Every page is its own chunk, so the first load only ships the shell.
const LoginPage = lazy(() => import("@/pages/auth/login-page"));
const AcceptInvitePage = lazy(() => import("@/pages/auth/accept-invite-page"));
const OverviewPage = lazy(() => import("@/pages/overview-page"));
const PlaceholderPage = lazy(() => import("@/pages/placeholder-page"));
const NotFoundPage = lazy(() => import("@/pages/not-found-page"));

export function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          {/* Same path the gateway returns as invitePath. */}
          <Route path="/invite/:token" element={<AcceptInvitePage />} />

          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<OverviewPage />} />
              <Route path="servers" element={<PlaceholderPage title="MCP servers" />} />
              <Route path="servers/:slug" element={<PlaceholderPage title="MCP server" />} />
              <Route path="chat" element={<PlaceholderPage title="AI chat" />} />
              <Route path="chat/:conversationId" element={<PlaceholderPage title="AI chat" />} />
              <Route path="keys" element={<PlaceholderPage title="API keys" />} />

              <Route element={<RequireAdmin />}>
                <Route path="team" element={<PlaceholderPage title="Team" />} />
                <Route path="audit" element={<PlaceholderPage title="Audit log" />} />
              </Route>

              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
