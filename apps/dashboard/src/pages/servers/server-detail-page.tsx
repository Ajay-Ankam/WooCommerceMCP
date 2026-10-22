import { AlertTriangle, ArrowLeft, ChevronRight, Pencil, Server, Trash2, Wrench } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useIsAdmin } from "@/auth/guards";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, ErrorState, PageSkeleton } from "@/components/page";
import { ServerStatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAdminServers, useServers, useTools } from "@/lib/queries";
import type { JsonSchema, ServerStatus } from "@/lib/types";
import { formatDateTime, splitToolName, timeAgo } from "@/lib/utils";
import { DeleteServerDialog, EnabledSwitch } from "./server-actions";
import { ServerFormDialog } from "./server-form-dialog";

interface ToolView {
  name: string;
  exposedName: string;
  description: string;
  inputSchema: JsonSchema;
  adminOnly?: boolean;
}

interface Param {
  name: string;
  type: string;
  required: boolean;
  description?: string;
}

// Top-level arguments from a JSON Schema object, for a readable summary.
function schemaParams(schema: JsonSchema): Param[] {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);

  return Object.entries(properties).map(([name, prop]) => {
    const type = Array.isArray(prop.type) ? prop.type.join(" | ") : prop.enum ? "enum" : String(prop.type ?? "any");
    return {
      name,
      type: type === "array" && (prop.items as { type?: string } | undefined)?.type ? `${(prop.items as { type: string }).type}[]` : type,
      required: required.has(name),
      description: typeof prop.description === "string" ? prop.description : undefined,
    };
  });
}

function ToolItem({ tool, showAdminOnly }: { tool: ToolView; showAdminOnly: boolean }) {
  const params = schemaParams(tool.inputSchema);
  const json = JSON.stringify(tool.inputSchema, null, 2);

  return (
    <li>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-3.5 transition-colors hover:bg-zinc-50 focus-visible:bg-zinc-50 focus-visible:outline-none [&::-webkit-details-marker]:hidden">
          <ChevronRight className="mt-0.5 size-4 shrink-0 text-zinc-400 transition-transform group-open:rotate-90" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-zinc-900">{tool.name}</span>
              {showAdminOnly && tool.adminOnly && <Badge tone="accent">Admin only</Badge>}
            </div>
            <p className="mt-0.5 line-clamp-2 text-sm text-zinc-500 group-open:line-clamp-none">
              {tool.description || "No description provided."}
            </p>
          </div>
          <span className="hidden shrink-0 text-xs tabular-nums text-zinc-400 sm:block">
            {params.length} {params.length === 1 ? "argument" : "arguments"}
          </span>
        </summary>

        <div className="space-y-4 border-t border-zinc-100 bg-zinc-50/50 px-5 py-4 sm:pl-12">
          <div>
            <p className="text-xs font-medium text-zinc-500">Exposed through the gateway as</p>
            <p className="mt-0.5 font-mono text-sm text-zinc-900">{tool.exposedName}</p>
          </div>

          {params.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-zinc-500">Arguments</p>
              <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200 bg-white">
                {params.map((param) => (
                  <li key={param.name} className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-zinc-900">{param.name}</span>
                      <span className="font-mono text-xs text-zinc-500">{param.type}</span>
                      {param.required && <Badge tone="warning">required</Badge>}
                    </div>
                    {param.description && <p className="mt-0.5 text-xs text-zinc-500">{param.description}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs font-medium text-zinc-500">Input schema</p>
              <CopyButton value={json} label="Copy schema" />
            </div>
            <pre className="max-h-80 overflow-auto rounded-md border border-zinc-200 bg-white p-3 font-mono text-xs leading-relaxed text-zinc-800">
              {json}
            </pre>
          </div>
        </div>
      </details>
    </li>
  );
}

function ToolsCard({ tools, status, showAdminOnly }: { tools: ToolView[]; status: ServerStatus; showAdminOnly: boolean }) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Tools</CardTitle>
          <CardDescription>
            {showAdminOnly ? "Discovered at the last successful check" : "Tools you can call on this server"}
          </CardDescription>
        </div>
        <Badge>{tools.length}</Badge>
      </CardHeader>
      {tools.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="No tools available"
          description={
            status === "disabled"
              ? "This server is disabled, so it exposes no tools."
              : status === "unreachable"
                ? "The gateway cannot reach this server right now."
                : status === "pending"
                  ? "The gateway is still checking this server."
                  : "This server exposes no tools you can use."
          }
        />
      ) : (
        <ul className="divide-y divide-zinc-100">
          {tools.map((tool) => (
            <ToolItem key={tool.exposedName} tool={tool} showAdminOnly={showAdminOnly} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function Header({ name, slug, status, actions }: { name: string; slug: string; status: ServerStatus; actions?: ReactNode }) {
  return (
    <div className="mb-6">
      <Link to="/servers" className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900">
        <ArrowLeft className="size-3.5" aria-hidden /> MCP servers
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-xl font-semibold tracking-tight text-zinc-900">{name}</h1>
            <ServerStatusBadge status={status} />
          </div>
          <p className="mt-1 font-mono text-xs text-zinc-500">{slug}</p>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <Card>
      <EmptyState
        icon={Server}
        title="Server not found"
        description="It may have been removed, or the link is wrong."
        action={
          <Link to="/servers" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
            Back to MCP servers
          </Link>
        }
      />
    </Card>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="mt-1 truncate text-sm text-zinc-900">{children}</dd>
    </div>
  );
}

function AdminServerDetail({ slug }: { slug: string }) {
  const servers = useAdminServers();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);

  if (servers.isPending) {
    return <PageSkeleton />;
  }

  if (servers.isError) {
    return <ErrorState error={servers.error} onRetry={() => void servers.refetch()} />;
  }

  const server = servers.data.find((s) => s.slug === slug);

  if (!server) {
    return <NotFound />;
  }

  return (
    <>
      <Header
        name={server.name}
        slug={server.slug}
        status={server.status}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil aria-hidden /> Edit
            </Button>
            <Button variant="danger-ghost" onClick={() => setRemoving(true)}>
              <Trash2 aria-hidden /> Remove
            </Button>
          </>
        }
      />
      <ServerFormDialog open={editing} onOpenChange={setEditing} server={server} />
      <DeleteServerDialog server={server} open={removing} onOpenChange={setRemoving} onDeleted={() => navigate("/servers", { replace: true })} />

      {server.managed && (
        <p className="mb-6 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-xs text-zinc-600">
          <span className="font-medium text-zinc-900">Managed by the deployment.</span> Its endpoint and credential come
          from the Helm values and are restored on every gateway restart; if removed, it is registered again. Name,
          enabled state and admin-only tools are yours to change. To turn it off permanently, disable it.
        </p>
      )}

      {server.status === "unreachable" && server.statusError && (
        <div role="alert" className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-red-800">The gateway cannot reach this server</p>
            <p className="mt-0.5 break-words font-mono text-xs text-red-700">{server.statusError}</p>
            <p className="mt-1 text-xs text-red-700">Other servers keep working; this one's tools are hidden until it recovers.</p>
          </div>
        </div>
      )}

      <Card className="mb-6">
        <dl className="grid gap-5 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="min-w-0 sm:col-span-2">
            <dt className="text-xs font-medium text-zinc-500">Endpoint</dt>
            <dd className="mt-1 flex items-center gap-2">
              <span className="truncate font-mono text-sm text-zinc-900" title={server.url}>
                {server.url}
              </span>
              <CopyButton value={server.url} label="Copy endpoint URL" />
            </dd>
          </div>
          <Detail label="Authentication">
            {server.authType === "none"
              ? "None"
              : `${server.authType === "bearer" ? "Bearer token" : `Header ${server.authHeaderName}`} · ${
                  server.hasCredential ? "credential stored" : "no credential"
                }`}
          </Detail>
          <div>
            <dt className="text-xs font-medium text-zinc-500">Enabled</dt>
            <dd className="mt-1.5">
              <EnabledSwitch server={server} />
            </dd>
          </div>
          <Detail label="Last checked">
            {server.checkedAt ? (
              <time dateTime={server.checkedAt} title={formatDateTime(server.checkedAt)}>
                {timeAgo(server.checkedAt)}
              </time>
            ) : (
              "Not yet"
            )}
          </Detail>
          <Detail label="Registered">{formatDateTime(server.createdAt)}</Detail>
          <Detail label="Admin-only tools">{server.adminOnlyTools.length > 0 ? server.adminOnlyTools.join(", ") : "None"}</Detail>
        </dl>
      </Card>

      <ToolsCard tools={server.tools} status={server.status} showAdminOnly />
    </>
  );
}

// Members see only the public status and the tools the gateway lets them call.
function MemberServerDetail({ slug }: { slug: string }) {
  const servers = useServers();
  const tools = useTools();

  if (servers.isPending || tools.isPending) {
    return <PageSkeleton />;
  }

  if (servers.isError || tools.isError) {
    const error = servers.error ?? tools.error;
    return <ErrorState error={error} onRetry={() => void Promise.all([servers.refetch(), tools.refetch()])} />;
  }

  const server = servers.data.find((s) => s.slug === slug);

  if (!server) {
    return <NotFound />;
  }

  const serverTools: ToolView[] = tools.data
    .filter((tool) => splitToolName(tool.name).server === slug)
    .map((tool) => ({
      name: splitToolName(tool.name).tool,
      exposedName: tool.name,
      description: tool.description ?? "",
      inputSchema: tool.inputSchema,
    }));

  return (
    <>
      <Header name={server.name} slug={server.slug} status={server.status} />
      <ToolsCard tools={serverTools} status={server.status} showAdminOnly={false} />
    </>
  );
}

export default function ServerDetailPage() {
  const { slug = "" } = useParams();
  return useIsAdmin() ? <AdminServerDetail slug={slug} /> : <MemberServerDetail slug={slug} />;
}
