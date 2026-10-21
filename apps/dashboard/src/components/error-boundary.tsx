import { Component, type ErrorInfo, type ReactNode } from "react";

import { ErrorState } from "@/components/page";

interface State {
  error: unknown;
}

// Catches render errors (and failed lazy-chunk loads after a redeploy) so one
// broken page never blanks the whole dashboard. Keyed by route by the caller.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Dashboard render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return <ErrorState error={this.state.error} onRetry={() => window.location.reload()} />;
    }

    return this.props.children;
  }
}
