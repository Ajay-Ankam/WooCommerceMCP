import { ChevronRight, RotateCw, ScrollText, X } from "lucide-react";
import { Fragment, useState, type SelectHTMLAttributes } from "react";
import { useSearchParams } from "react-router";

import { useIsAdmin } from "@/auth/guards";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { OutcomeBadge, SourceLabel } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLog, useServers, useUsers } from "@/lib/queries";
import type { AuditEntry, AuditOutcome, AuditSource } from "@/lib/types";
import { cn, formatDateTime, formatDuration, timeAgo } from "@/lib/utils";

const OUTCOMES: Array<[AuditOutcome, string]> = [
  ["success", "Success"],
  ["denied", "Denied"],
  ["error", "Error"],
];

const SOURCES: Array<[AuditSource, string]> = [
  ["mcp", "MCP clients"],
  ["chat", "AI chat"],
  ["rest", "REST API"],
];

// Native select styled like Input: accessible and dependency-free.
function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-9 w-full rounded-md border border-zinc-300 bg-white px-2.5 text-sm text-zinc-900 shadow-sm",
        "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20",
        className,
      )}
      {...props}
    />
  );
}

// Filters live in the URL, so a filtered view survives reloads and can be shared.
function useFilters() {
  const [params, setParams] = useSearchParams();
  const userId = Number(params.get("user")) || undefined;
  const filters = {
    userId,
    server: params.get("server") || undefined,
    outcome: (params.get("outcome") as AuditOutcome | null) || undefined,
    source: (params.get("source") as AuditSource | null) || undefined,
  };

  function set(name: "user" | "server" | "outcome" | "source", value: string) {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(name, value);
        } else {
          next.delete(name);
        }
        return next;
      },
      { replace: true },
    );
  }

  const active = Object.values(filters).some((v) => v !== undefined);
  return { filters, set, active, clear: () => setParams({}, { replace: true }) };
}

function Filters({ isAdmin, state }: { isAdmin: boolean; state: ReturnType<typeof useFilters> }) {
  const servers = useServers();
  const users = useUsers(isAdmin);
  const { filters, set } = state;

  return (
    <div className="grid gap-3 border-b border-zinc-100 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
      {isAdmin && (
        <div className="space-y-1">
          <Label htmlFor="filter-user">User</Label>
          <Select id="filter-user" value={filters.userId ?? ""} onChange={(e) => set("user", e.target.value)}>
            <option value="">Everyone</option>
            {users.data?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.email}
              </option>
            ))}
          </Select>
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="filter-server">Server</Label>
        <Select id="filter-server" value={filters.server ?? ""} onChange={(e) => set("server", e.target.value)}>
          <option value="">All servers</option>
          {servers.data?.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.name}
            </option>
          ))}
          {/* Keep a filter for a removed server selectable. */}
          {filters.server && servers.data && !servers.data.some((s) => s.slug === filters.server) && (
            <option value={filters.server}>{filters.server}</option>
          )}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="filter-outcome">Outcome</Label>
        <Select id="filter-outcome" value={filters.outcome ?? ""} onChange={(e) => set("outcome", e.target.value)}>
          <option value="">Any outcome</option>
          {OUTCOMES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="filter-source">Via</Label>
        <Select id="filter-source" value={filters.source ?? ""} onChange={(e) => set("source", e.target.value)}>
          <option value="">Any source</option>
          {SOURCES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}

function EntryRow({ entry, isAdmin }: { entry: AuditEntry; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  // Only failures carry a message; arguments and results are never recorded.
  const expandable = !!entry.error;
  const columns = isAdmin ? 7 : 6;

  return (
    <Fragment>
      <tr className={cn("transition-colors", expandable && "cursor-pointer hover:bg-zinc-50/60")} onClick={() => expandable && setOpen(!open)}>
        <td className="whitespace-nowrap px-5 py-2.5 text-zinc-600">
          <time dateTime={entry.startedAt} title={timeAgo(entry.startedAt)}>
            {formatDateTime(entry.startedAt)}
          </time>
        </td>
        {isAdmin && (
          <td className="max-w-48 truncate px-3 py-2.5 text-zinc-600" title={entry.userEmail ?? undefined}>
            {entry.userEmail ?? <span className="text-zinc-400">Unknown</span>}
          </td>
        )}
        <td className="max-w-64 px-3 py-2.5">
          <p className="truncate font-mono text-xs text-zinc-900">{entry.tool}</p>
          <p className="truncate text-xs text-zinc-500">{entry.serverSlug ?? "gateway"}</p>
        </td>
        <td className="px-3 py-2.5">
          <SourceLabel source={entry.source} />
        </td>
        <td className="px-3 py-2.5">
          <OutcomeBadge outcome={entry.outcome} />
        </td>
        <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{formatDuration(entry.durationMs)}</td>
        <td className="w-10 pr-5 text-right">
          {expandable && (
            <button
              type="button"
              aria-expanded={open}
              aria-label={open ? "Hide details" : "Show details"}
              onClick={(e) => {
                e.stopPropagation();
                setOpen(!open);
              }}
              className="rounded-sm text-zinc-400 hover:text-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} aria-hidden />
            </button>
          )}
        </td>
      </tr>
      {open && entry.error && (
        <tr className="bg-zinc-50/50">
          <td colSpan={columns} className="px-5 pb-3 pt-1">
            <p className="text-xs font-medium text-zinc-500">{entry.outcome === "denied" ? "Reason" : "Error"}</p>
            <p className="mt-0.5 break-words font-mono text-xs text-zinc-800">{entry.error}</p>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

export default function AuditPage() {
  const isAdmin = useIsAdmin();
  const filterState = useFilters();
  const log = useAuditLog(isAdmin ? "all" : "mine", filterState.filters);
  const entries = log.data?.pages.flat() ?? [];

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          isAdmin
            ? "Every tool call through the gateway, by anyone on the team. Arguments and results are never recorded."
            : "Every tool call made with your account. Arguments and results are never recorded."
        }
        actions={
          <Button variant="secondary" onClick={() => void log.refetch()} loading={log.isRefetching && !log.isFetchingNextPage}>
            <RotateCw aria-hidden /> Refresh
          </Button>
        }
      />

      <Card>
        <Filters isAdmin={isAdmin} state={filterState} />

        {log.isPending ? (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading audit log">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : log.isError ? (
          <ErrorState error={log.error} onRetry={() => void log.refetch()} />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title={filterState.active ? "No matching calls" : "No tool calls yet"}
            description={
              filterState.active
                ? "Try removing a filter."
                : "Calls from the AI chat, MCP clients and the REST API appear here."
            }
            action={
              filterState.active ? (
                <Button size="sm" variant="secondary" onClick={filterState.clear}>
                  <X aria-hidden /> Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr className="border-b border-zinc-100">
                    <th scope="col" className="px-5 py-2.5 font-medium">Time</th>
                    {isAdmin && <th scope="col" className="px-3 py-2.5 font-medium">User</th>}
                    <th scope="col" className="px-3 py-2.5 font-medium">Tool</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Via</th>
                    <th scope="col" className="px-3 py-2.5 font-medium">Outcome</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-medium">Duration</th>
                    <th scope="col" className="pr-5"><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} isAdmin={isAdmin} />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-zinc-100 px-5 py-3">
              <p className="text-xs text-zinc-500">
                {entries.length} {entries.length === 1 ? "entry" : "entries"}
                {log.hasNextPage ? " loaded" : ""}
              </p>
              {log.hasNextPage && (
                <Button size="sm" variant="secondary" loading={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                  Load older
                </Button>
              )}
            </div>
          </>
        )}
      </Card>
    </>
  );
}
