import { Bot, Info, Loader2, MessageSquare, Plus, SendHorizontal, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

import { useIsAdmin } from "@/auth/guards";
import { EmptyState, ErrorState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError } from "@/lib/api";
import {
  chatErrorConversation,
  useChatStatus,
  useConversation,
  useConversations,
  useDecideAction,
  useDeleteConversation,
  useSendMessage,
} from "@/lib/queries";
import type { ChatResult, ChatUnavailable, ConversationSummary } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { buildThread, FailureCard, PendingActionCard, ThreadMessage } from "./chat-thread";

const MAX_MESSAGE = 4000;

// Spending quota only when clicked; nothing is sent automatically.
const SUGGESTIONS = {
  member: ["How many orders came in today?", "Summarize sales for the last 30 days", "What are the top 5 products by revenue?"],
  admin: ["Create a draft product called AJAY Demo Mug priced at 12.99"],
};

// Per-turn details the stored history does not keep.
interface TurnInfo {
  conversationId: number;
  provider: string;
  model: string;
  fellBack: boolean;
  incomplete: boolean;
}

function turnInfo(result: ChatResult): TurnInfo {
  return {
    conversationId: result.conversationId,
    provider: result.provider,
    model: result.model,
    fellBack: result.fallbacks.length > 0,
    incomplete: result.incomplete,
  };
}

function useElapsed(running: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!running) {
      setSeconds(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  return seconds;
}

function ConversationList({ activeId, onDelete }: { activeId?: number; onDelete: (c: ConversationSummary) => void }) {
  const conversations = useConversations();

  if (conversations.isPending) {
    return (
      <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading conversations">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    );
  }

  if (conversations.isError) {
    return <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} />;
  }

  if (conversations.data.length === 0) {
    return <p className="px-4 py-6 text-center text-xs text-zinc-500">No conversations yet.</p>;
  }

  return (
    <ul className="space-y-0.5 p-2">
      {conversations.data.map((c) => (
        <li key={c.id} className="group relative">
          <Link
            to={`/chat/${c.id}`}
            aria-current={c.id === activeId ? "page" : undefined}
            className={cn(
              "block rounded-md py-2 pl-3 pr-9 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
              c.id === activeId ? "bg-indigo-50 text-indigo-900" : "text-zinc-700 hover:bg-zinc-50",
            )}
          >
            <p className="truncate text-sm font-medium">{c.title}</p>
            <p className="text-xs text-zinc-500">{timeAgo(c.updatedAt)}</p>
          </Link>
          <button
            type="button"
            onClick={() => onDelete(c)}
            aria-label={`Delete conversation ${c.title}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-1 text-zinc-400 opacity-0 transition-opacity hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 group-hover:opacity-100"
          >
            <Trash2 className="size-3.5" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function ChatPage() {
  const params = useParams();
  const conversationId = params.conversationId ? Number(params.conversationId) || undefined : undefined;
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();

  const status = useChatStatus();
  const conversation = useConversation(conversationId);
  const send = useSendMessage();
  const decide = useDecideAction();
  const remove = useDeleteConversation();

  const [draft, setDraft] = useState("");
  const [sendingText, setSendingText] = useState<string | null>(null);
  const [failure, setFailure] = useState<(ChatUnavailable & { forId: number }) | null>(null);
  const [turn, setTurn] = useState<TurnInfo | null>(null);
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const busy = send.isPending || decide.isPending;
  const elapsed = useElapsed(busy);
  const chatEnabled = status.data?.enabled ?? false;
  const pending = conversation.data?.pendingAction ?? null;
  const thread = conversation.data ? buildThread(conversation.data.messages, pending) : [];

  // Per-conversation transient state does not follow you to another chat.
  useEffect(() => {
    setFailure(null);
    decide.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [thread.length, sendingText, pending?.id, failure]);

  function submit(text: string) {
    const message = text.trim();
    if (!message || busy || !chatEnabled) {
      return;
    }

    setSendingText(message);
    setFailure(null);
    setDraft("");
    send.mutate(
      { conversationId, message },
      {
        onSuccess: (result) => {
          setTurn(turnInfo(result));
          if (result.conversationId !== conversationId) {
            navigate(`/chat/${result.conversationId}`);
          }
        },
        onError: (error) => {
          const id = chatErrorConversation(error);
          if (id !== undefined && isApiError(error, 503)) {
            setFailure({ ...(error.body as ChatUnavailable), forId: id });
            if (id !== conversationId) {
              navigate(`/chat/${id}`);
            }
            return;
          }
          // Nothing was saved, so give the text back.
          setDraft(message);
          toast.error(errorMessage(error));
        },
        onSettled: () => {
          setSendingText(null);
          input.current?.focus();
        },
      },
    );
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    submit(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit(draft);
    }
  }

  function onDecide(decision: "approve" | "reject") {
    if (!conversationId || !pending || decide.isPending) {
      return;
    }

    decide.mutate(
      { conversationId, actionId: pending.id, decision },
      {
        onSuccess: (result) => setTurn(turnInfo(result)),
        onError: (error) => {
          if (isApiError(error, 503) && chatErrorConversation(error) !== undefined) {
            setFailure({ ...(error.body as ChatUnavailable), forId: conversationId });
            decide.reset();
          } else if (isApiError(error, 409) || isApiError(error, 410)) {
            // Already decided or expired: the refreshed conversation shows the outcome.
            toast.error(errorMessage(error));
            decide.reset();
          }
        },
      },
    );
  }

  const decideError =
    decide.error && !isApiError(decide.error, 409) && !isApiError(decide.error, 410) && !isApiError(decide.error, 503)
      ? errorMessage(decide.error)
      : null;
  const showTurn = turn && turn.conversationId === conversationId && !busy;
  const notFound = conversation.isError && isApiError(conversation.error, 404);

  return (
    <div className="flex h-[calc(100dvh-6.5rem)] min-h-[28rem] gap-4">
      <Card className="hidden w-64 shrink-0 flex-col overflow-hidden lg:flex">
        <div className="border-b border-zinc-100 p-3">
          <Button className="w-full" variant="secondary" onClick={() => navigate("/chat")}>
            <Plus aria-hidden /> New chat
          </Button>
        </div>
        <nav aria-label="Conversations" className="flex-1 overflow-y-auto">
          <ConversationList activeId={conversationId} onDelete={setDeleting} />
        </nav>
      </Card>

      <Card className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-zinc-900">{conversation.data?.title ?? "New chat"}</h1>
            <p className="truncate text-xs text-zinc-500">
              {status.data?.providers.length
                ? `Tools run as you through the gateway · ${status.data.providers.map((p) => p.provider).join(" → ")}`
                : "Tools run as you through the gateway"}
            </p>
          </div>
          <Button size="sm" variant="secondary" className="lg:hidden" onClick={() => navigate("/chat")}>
            <Plus aria-hidden /> New
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6" aria-live="polite">
          {status.isSuccess && !chatEnabled ? (
            <EmptyState
              icon={Bot}
              title="AI chat is not configured"
              description="Add a Gemini or Groq API key to the gateway's environment to enable it."
            />
          ) : notFound ? (
            <EmptyState
              icon={MessageSquare}
              title="Conversation not found"
              description="It may have been deleted."
              action={
                <Button size="sm" variant="secondary" onClick={() => navigate("/chat")}>
                  Start a new chat
                </Button>
              }
            />
          ) : conversation.isError ? (
            <ErrorState error={conversation.error} onRetry={() => void conversation.refetch()} />
          ) : conversationId && conversation.isPending ? (
            <div className="space-y-4" aria-busy="true" aria-label="Loading conversation">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-16 w-3/4" />
            </div>
          ) : thread.length === 0 && !sendingText ? (
            <div className="mx-auto flex max-w-md flex-col items-center py-10 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
                <Bot className="size-5" aria-hidden />
              </span>
              <h2 className="mt-3 text-sm font-semibold text-zinc-900">Ask about your store</h2>
              <p className="mt-1 text-sm text-zinc-500">
                The assistant uses the gateway’s tools with your permissions.
                {isAdmin ? " Anything that changes the store waits for your approval." : ""}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {[...SUGGESTIONS.member, ...(isAdmin ? SUGGESTIONS.admin : [])].map((text) => (
                  <button
                    key={text}
                    type="button"
                    disabled={!chatEnabled || busy}
                    onClick={() => submit(text)}
                    className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition-colors hover:border-indigo-300 hover:bg-indigo-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5">
              {thread.map((item) => (
                <ThreadMessage key={item.key} item={item} />
              ))}

              {sendingText && (
                <div className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600/80 px-4 py-2.5 text-sm text-white">
                    {sendingText}
                  </p>
                </div>
              )}

              {pending && !sendingText && (
                <PendingActionCard
                  action={pending}
                  busy={decide.isPending}
                  decision={decide.variables?.decision ?? null}
                  error={decideError}
                  onDecide={onDecide}
                />
              )}

              {busy && (
                <p className="flex items-center gap-2 text-sm text-zinc-500" role="status">
                  <Loader2 className="size-4 animate-spin text-indigo-500" aria-hidden />
                  {decide.isPending && decide.variables?.decision === "approve" ? "Running the approved action…" : "Thinking…"}
                  <span className="tabular-nums text-zinc-400">{elapsed}s</span>
                </p>
              )}

              {failure && failure.forId === conversationId && !busy && (
                <FailureCard failures={failure.failures} toolCalls={failure.toolCalls} onDismiss={() => setFailure(null)} />
              )}

              {showTurn && (turn.fellBack || turn.incomplete) && (
                <p className="flex items-start gap-1.5 text-xs text-zinc-500">
                  <Info className="mt-px size-3.5 shrink-0" aria-hidden />
                  {turn.incomplete
                    ? "The assistant stopped after the maximum number of tool rounds. The tools listed above did run."
                    : `Answered by the fallback provider (${turn.provider}, ${turn.model}).`}
                </p>
              )}
              <div ref={bottom} />
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} className="border-t border-zinc-100 p-3 sm:p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2">
            <label htmlFor="chat-input" className="sr-only">
              Message
            </label>
            <textarea
              id="chat-input"
              ref={input}
              rows={1}
              value={draft}
              maxLength={MAX_MESSAGE}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={!chatEnabled || busy}
              placeholder={
                pending
                  ? "Approve or reject the action above, or send a new message to cancel it"
                  : "Ask about products, orders or sales…"
              }
              className="field-sizing-content max-h-40 min-h-9 w-full resize-none rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-zinc-50"
            />
            <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || !chatEnabled || busy}>
              <SendHorizontal aria-hidden />
            </Button>
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-zinc-400">
            Enter to send · Shift+Enter for a new line · Every tool call is audited under your account
          </p>
        </form>
      </Card>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) {
            remove.reset();
            setDeleting(null);
          }
        }}
        title="Delete this conversation?"
        description="The messages are removed for good. Tool calls it made stay in the audit log."
        confirmLabel="Delete"
        loading={remove.isPending}
        error={remove.error ? errorMessage(remove.error) : null}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => {
              if (deleting.id === conversationId) {
                navigate("/chat", { replace: true });
              }
              setDeleting(null);
            },
          })
        }
      />
    </div>
  );
}
