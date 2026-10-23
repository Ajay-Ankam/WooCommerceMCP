import { AlertTriangle, Bot, Check, ChevronRight, CircleAlert, Clock, ShieldAlert, X } from "lucide-react";
import { useEffect, useState } from "react";

import { CopyButton } from "@/components/copy-button";
import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ChatMessage, ChatToolCall, PendingAction, ProviderFailure, ToolTrace } from "@/lib/types";
import { cn, formatDateTime, splitToolName } from "@/lib/utils";

const MAX_RESULT_CHARS = 4000;

type ToolState = "ok" | "error" | "waiting";

interface CallView {
  call: ChatToolCall;
  state: ToolState;
  result?: string;
}

export type ThreadItem =
  | { kind: "user"; key: string; text: string }
  | { kind: "assistant"; key: string; text: string; calls: CallView[] };

// Folds stored tool results into the assistant message that requested them,
// so each answer shows which tools it used and what they returned.
export function buildThread(messages: ChatMessage[], pending: PendingAction | null): ThreadItem[] {
  const results = new Map<string, { content: string; isError: boolean }>();

  for (const message of messages) {
    if (message.role === "tool") {
      results.set(message.toolCallId, { content: message.content, isError: message.isError });
    }
  }

  const items: ThreadItem[] = [];

  messages.forEach((message, index) => {
    if (message.role === "user") {
      items.push({ kind: "user", key: `u${index}`, text: message.text });
    } else if (message.role === "assistant") {
      const calls = message.toolCalls.map((call): CallView => {
        const result = results.get(call.id);
        return result
          ? { call, state: result.isError ? "error" : "ok", result: result.content }
          : pending?.name === call.name
            ? { call, state: "waiting" }
            : { call, state: "error", result: "No result recorded." };
      });

      // Tool-only rounds without text merge into the next answer's tool list.
      const previous = items[items.length - 1];
      if (previous?.kind === "assistant" && !previous.text) {
        previous.calls.push(...calls);
        previous.text = message.text;
        previous.key = `a${index}`;
      } else {
        items.push({ kind: "assistant", key: `a${index}`, text: message.text, calls });
      }
    }
  });

  return items;
}

function ToolName({ name }: { name: string }) {
  const { server, tool } = splitToolName(name);
  return (
    <span className="min-w-0 truncate font-mono text-xs" title={name}>
      <span className="text-zinc-400">{server}__</span>
      <span className="text-zinc-900">{tool}</span>
    </span>
  );
}

const STATE_BADGE: Record<ToolState, { tone: "success" | "danger" | "warning"; label: string }> = {
  ok: { tone: "success", label: "Succeeded" },
  error: { tone: "danger", label: "Failed" },
  waiting: { tone: "warning", label: "Awaiting approval" },
};

function ToolCallChip({ view }: { view: CallView }) {
  const result =
    view.result && view.result.length > MAX_RESULT_CHARS
      ? `${view.result.slice(0, MAX_RESULT_CHARS)}\n… ${view.result.length - MAX_RESULT_CHARS} more characters`
      : view.result;

  return (
    <li>
      <details className="group rounded-md border border-zinc-200 bg-white">
        {/* <summary> ignores display:flex in some browsers, so the row layout
            lives on an inner element. */}
        <summary className="cursor-pointer list-none px-2.5 py-1.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2">
              <ChevronRight className="size-3.5 shrink-0 text-zinc-400 transition-transform group-open:rotate-90" aria-hidden />
              <ToolName name={view.call.name} />
            </span>
            <Badge tone={STATE_BADGE[view.state].tone} dot className="shrink-0">
              {STATE_BADGE[view.state].label}
            </Badge>
          </span>
        </summary>
        <div className="space-y-2 border-t border-zinc-100 px-2.5 py-2">
          <div>
            <p className="text-[11px] font-medium text-zinc-500">Arguments</p>
            <pre className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-zinc-800">
              {JSON.stringify(view.call.arguments, null, 2)}
            </pre>
          </div>
          {result !== undefined && (
            <div>
              <p className="text-[11px] font-medium text-zinc-500">Result</p>
              <pre
                className={cn(
                  "mt-0.5 max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs",
                  view.state === "error" ? "text-red-700" : "text-zinc-800",
                )}
              >
                {result}
              </pre>
            </div>
          )}
        </div>
      </details>
    </li>
  );
}

export function ThreadMessage({ item }: { item: ThreadItem }) {
  if (item.kind === "user") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600 px-4 py-2.5 text-sm text-white">
          {item.text}
        </p>
      </div>
    );
  }

  return (
    <div className="group/msg flex gap-3">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-600" aria-hidden>
        <Bot className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {item.calls.length > 0 && (
          <ul className="space-y-1.5" aria-label="Tools used">
            {item.calls.map((view) => (
              <ToolCallChip key={view.call.id} view={view} />
            ))}
          </ul>
        )}
        {item.text && (
          <div className="flex items-start gap-2">
            <Markdown className="flex-1">{item.text}</Markdown>
            <CopyButton value={item.text} label="Copy answer" variant="ghost" className="opacity-0 transition-opacity focus-visible:opacity-100 group-hover/msg:opacity-100" />
          </div>
        )}
      </div>
    </div>
  );
}

function formatValue(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

// The only way a chat write runs. The arguments shown are the ones the
// gateway stored and will execute; the buttons send nothing but the decision.
export function PendingActionCard({
  action,
  busy,
  decision,
  error,
  onDecide,
}: {
  action: PendingAction;
  busy: boolean;
  decision: "approve" | "reject" | null;
  error: string | null;
  onDecide: (decision: "approve" | "reject") => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  const expired = Date.parse(action.expiresAt) <= now;
  const { server, tool } = splitToolName(action.name);
  const entries = Object.entries(action.arguments);

  return (
    <section role="alert" aria-label="Action needs your approval" className="rounded-lg border border-amber-200 bg-amber-50/70 p-4">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900">
            Approve <span className="font-mono">{tool}</span> on <span className="font-mono">{server}</span>?
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            This changes data in the store. Nothing runs unless you approve, and it runs exactly as shown.
          </p>

          <dl className="mt-3 divide-y divide-amber-100 rounded-md border border-amber-200 bg-white">
            {entries.length === 0 ? (
              <p className="px-3 py-2 text-xs text-zinc-500">No arguments</p>
            ) : (
              entries.map(([key, value]) => (
                <div key={key} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-3 px-3 py-2">
                  <dt className="truncate font-mono text-xs text-zinc-500">{key}</dt>
                  <dd className="whitespace-pre-wrap break-words text-xs text-zinc-900">{formatValue(value)}</dd>
                </div>
              ))
            )}
          </dl>

          {error && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-700">
              <CircleAlert className="size-3.5" aria-hidden /> {error}
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => onDecide("approve")} disabled={busy || expired} loading={busy && decision === "approve"}>
              <Check aria-hidden /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onDecide("reject")} disabled={busy} loading={busy && decision === "reject"}>
              <X aria-hidden /> Reject
            </Button>
            <span className="ml-auto flex items-center gap-1 text-xs text-amber-800">
              <Clock className="size-3.5" aria-hidden />
              {expired ? "Expired" : `Expires ${formatDateTime(action.expiresAt)}`}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

export function FailureCard({ failures, toolCalls, onDismiss }: { failures: ProviderFailure[]; toolCalls: ToolTrace[]; onDismiss: () => void }) {
  return (
    <section role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-red-800">No AI provider could answer</p>
          <p className="mt-0.5 text-xs text-red-700">Nothing was made up. Your message is saved; try again in a moment.</p>
          <ul className="mt-2 space-y-1">
            {failures.map((f, i) => (
              <li key={i} className="break-words font-mono text-xs text-red-800">
                {f.provider} ({f.model}): {f.kind} — {f.message}
              </li>
            ))}
          </ul>
          {toolCalls.length > 0 && (
            <p className="mt-2 text-xs text-red-700">
              Tools that did run before the failure: {toolCalls.map((t) => t.name).join(", ")}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="rounded-sm text-red-400 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>
    </section>
  );
}
