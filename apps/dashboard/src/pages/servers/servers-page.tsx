import { ChevronRight, MoreHorizontal, Pencil, Plus, Server, Trash2 } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState } from "react";
import { Link } from "react-router";

import { useIsAdmin } from "@/auth/guards";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { ServerStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminServers, useServers } from "@/lib/queries";
import type { AdminServer } from "@/lib/types";
import { formatDateTime, timeAgo } from "@/lib/utils";
import { DeleteServerDialog, EnabledSwitch } from "./server-actions";
import { ServerFormDialog } from "./server-form-dialog";

const AUTH_LABEL = { none: "None", bearer: "Bearer", header: "Header" } as const;

function TableSkeleton() {
  return (
    <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading servers">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-12" />
      ))}
    </div>
  );
}

function CheckedAt({ iso }: { iso: string | null }) {
  return iso ? (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {timeAgo(iso)}
    </time>
  ) : (
    <span>—</span>
  );
}

const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900";

function RowMenu({ server }: { server: AdminServer }) {
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  return (
    <>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${server.name}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-44 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
            <DropdownMenu.Item className={menuItem} onSelect={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className={`${menuItem} text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700`}
              onSelect={() => setRemoving(true)}
            >
              <Trash2 className="size-4" aria-hidden /> Remove
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <ServerFormDialog open={editing} onOpenChange={setEditing} server={server} />
      <DeleteServerDialog server={server} open={removing} onOpenChange={setRemoving} />
    </>
  );
}

function AdminServers() {
  const servers = useAdminServers();
  const [registering, setRegistering] = useState(false);

  return (
    <>
      <PageHeader
        title="MCP servers"
        description="Upstream servers aggregated behind the gateway's single MCP endpoint."
        actions={
          <Button onClick={() => setRegistering(true)}>
            <Plus aria-hidden /> Register server
          </Button>
        }
      />
      <ServerFormDialog open={registering} onOpenChange={setRegistering} />

      <Card>
        {servers.isPending ? (
          <TableSkeleton />
        ) : servers.isError ? (
          <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
        ) : servers.data.length === 0 ? (
          <EmptyState
            icon={Server}
            title="No servers registered"
            description="Register an upstream MCP server to expose its tools through the gateway."
            action={
              <Button size="sm" onClick={() => setRegistering(true)}>
                <Plus aria-hidden /> Register server
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th scope="col" className="px-5 py-2.5 font-medium">Server</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Tools</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Auth</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Checked</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Enabled</th>
                  <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {servers.data.map((server) => (
                  <tr key={server.slug} className="transition-colors hover:bg-zinc-50/60">
                    <td className="max-w-72 px-5 py-3">
                      <Link
                        to={`/servers/${server.slug}`}
                        className="block truncate font-medium text-zinc-900 hover:text-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded-sm"
                      >
                        {server.name}
                      </Link>
                      <p className="truncate font-mono text-xs text-zinc-500" title={server.url}>
                        {server.slug} · {server.url}
                      </p>
                    </td>
                    <td className="px-3 py-3">
                      <ServerStatusBadge status={server.status} />
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-600">
                      {server.tools.length}
                      {server.adminOnlyTools.length > 0 && (
                        <span className="ml-1 text-xs text-zinc-400" title="Admin-only tools">
                          ({server.adminOnlyTools.length} admin)
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <Badge>{AUTH_LABEL[server.authType]}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                      <CheckedAt iso={server.checkedAt} />
                    </td>
                    <td className="px-3 py-3">
                      <EnabledSwitch server={server} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <RowMenu server={server} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function MemberServers() {
  const servers = useServers();

  return (
    <>
      <PageHeader title="MCP servers" description="Upstream servers available to you through the gateway." />
      <Card>
        {servers.isPending ? (
          <TableSkeleton />
        ) : servers.isError ? (
          <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />
        ) : servers.data.length === 0 ? (
          <EmptyState icon={Server} title="No servers registered" description="Ask an admin to register upstream MCP servers." />
        ) : (
          <ul className="divide-y divide-zinc-100">
            {servers.data.map((server) => (
              <li key={server.slug}>
                <Link
                  to={`/servers/${server.slug}`}
                  className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-zinc-900">{server.name}</p>
                    <p className="truncate font-mono text-xs text-zinc-500">{server.slug}</p>
                  </div>
                  <span className="hidden text-xs tabular-nums text-zinc-500 sm:block">
                    {server.toolCount} {server.toolCount === 1 ? "tool" : "tools"}
                  </span>
                  <ServerStatusBadge status={server.status} />
                  <ChevronRight className="size-4 text-zinc-400" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

export default function ServersPage() {
  return useIsAdmin() ? <AdminServers /> : <MemberServers />;
}
