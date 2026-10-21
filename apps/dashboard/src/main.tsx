import "@fontsource-variable/inter";
import "./index.css";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";

import { App } from "./app";
import { isApiError } from "./lib/api";
import { keys } from "./lib/queries";

// An expired or revoked session surfaces as a 401 on any request; clearing the
// cached user sends the app back to the login page via RequireAuth.
function onUnauthorized(error: unknown) {
  if (isApiError(error, 401)) {
    queryClient.setQueryData(keys.me, null);
  }
}

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onUnauthorized }),
  mutationCache: new MutationCache({ onError: onUnauthorized }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Retry once on gateway/network failures; never on 4xx (auth, validation).
      retry: (failureCount, error) => failureCount < 1 && (!isApiError(error) || error.status === 0 || error.status >= 500),
    },
    // Mutations are never retried: a repeated write could run twice.
    mutations: { retry: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster position="bottom-right" closeButton />
    </QueryClientProvider>
  </StrictMode>,
);
