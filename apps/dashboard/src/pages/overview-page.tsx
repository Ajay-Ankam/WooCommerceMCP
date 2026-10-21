import { Activity, ArrowRight, CircleCheck, CircleOff, CircleX, Server, Wrench, type LucideIcon } from "lucide-react";
import { Link } from "react-router";

import { useIsAdmin } from "@/auth/guards";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { OutcomeBadge, ServerStatusBadge, SourceLabel } from "@/components/status";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAudit, useServers, useTools } from "@/lib/queries";
import { cn, formatDateTime, formatDuration, timeAgo } from "@/lib/utils";

function StatCard({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: string;
  loading: boolean;
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-zinc-500">{label}</p>
        <Icon className={cn("size-4", tone)} aria-hidden />
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-8 w-12" />
      ) : (
        <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-zinc-900">{value ?? "—"}</p>
      )}
    </Card>
  );
}

function ServersCard() {
  const servers = useServers();

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <div>
          <CardTitle>MCP servers</CardTitle>
          <CardDescription>Upstreams aggregated behind the gateway</CardDescription>
        </div>
        <Link to="/servers" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
          View all <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </CardHeader>
      {servers.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : servers.isError ? (
        <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
      ) : servers.data.length === 0 ? (
        <EmptyState icon={Server} title="No servers registered" description="An admin can register upstream MCP servers." />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {servers.data.map((server) => (
            <li key={server.slug}>
              <Link
                to={`/servers/${server.slug}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-zinc-900">{server.name}</p>
                  <p className="truncate font-mono text-xs text-zinc-500">{server.slug}</p>
                </div>
                <span className="hidden text-xs tabular-nums text-zinc-500 sm:block">
                  {server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}
                </span>
                <ServerStatusBadge status={server.status} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ActivityCard() {
  const isAdmin = useIsAdmin();
  const audit = useAudit(isAdmin ? "all" : "mine", { limit: 8 });

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <div>
          <CardTitle>Recent tool calls</CardTitle>
          <CardDescription>{isAdmin ? "Across the whole team" : "Calls made with your account"}</CardDescription>
        </div>
        {isAdmin && (
          <Link to="/audit" className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700">
            Audit log <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </CardHeader>
      {audit.isPending ? (
        <div className="space-y-3 p-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-8" />
          ))}
        </div>
      ) : audit.isError ? (
        <ErrorState error={audit.error} onRetry={() => void audit.refetch()} />
      ) : audit.data.length === 0 ? (
        <EmptyState
          icon={Activity}
          title="No tool calls yet"
          description="Calls from the chat, MCP clients and the REST API appear here."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr className="border-b border-zinc-100">
                <th scope="col" className="px-5 py-2.5 font-medium">Tool</th>
                {isAdmin && <th scope="col" className="px-3 py-2.5 font-medium">User</th>}
                <th scope="col" className="px-3 py-2.5 font-medium">Via</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Outcome</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Duration</th>
                <th scope="col" className="px-5 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {audit.data.map((entry) => (
                <tr key={entry.id}>
                  <td className="max-w-56 px-5 py-2.5">
                    <p className="truncate font-mono text-xs text-zinc-900">{entry.tool}</p>
                    <p className="truncate text-xs text-zinc-500">{entry.serverSlug ?? "—"}</p>
                  </td>
                  {isAdmin && <td className="max-w-48 truncate px-3 py-2.5 text-zinc-600">{entry.userEmail ?? "—"}</td>}
                  <td className="px-3 py-2.5">
                    <SourceLabel source={entry.source} />
                  </td>
                  <td className="px-3 py-2.5">
                    <OutcomeBadge outcome={entry.outcome} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">{formatDuration(entry.durationMs)}</td>
                  <td className="whitespace-nowrap px-5 py-2.5 text-right text-zinc-500">
                    <time dateTime={entry.startedAt} title={formatDateTime(entry.startedAt)}>
                      {timeAgo(entry.startedAt)}
                    </time>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function OverviewPage() {
  const servers = useServers();
  const tools = useTools();
  const count = (status: string) => servers.data?.filter((s) => s.status === status).length;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Health of your MCP upstreams and the latest tool activity through the gateway."
      />

      <section aria-label="Summary" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Connected" value={count("connected")} icon={CircleCheck} tone="text-emerald-500" loading={servers.isPending} />
        <StatCard label="Unreachable" value={count("unreachable")} icon={CircleX} tone="text-red-500" loading={servers.isPending} />
        <StatCard label="Disabled" value={count("disabled")} icon={CircleOff} tone="text-zinc-400" loading={servers.isPending} />
        <StatCard label="Tools available" value={tools.data?.length} icon={Wrench} tone="text-indigo-500" loading={tools.isPending} />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <ServersCard />
        <ActivityCard />
      </div>
    </>
  );
}
