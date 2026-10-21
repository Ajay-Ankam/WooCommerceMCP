import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { AuditOutcome, AuditSource, ServerStatus } from "@/lib/types";

const SERVER_STATUS: Record<ServerStatus, { label: string; tone: BadgeTone }> = {
  connected: { label: "Connected", tone: "success" },
  pending: { label: "Checking", tone: "warning" },
  unreachable: { label: "Unreachable", tone: "danger" },
  disabled: { label: "Disabled", tone: "neutral" },
};

export function ServerStatusBadge({ status }: { status: ServerStatus }) {
  const { label, tone } = SERVER_STATUS[status];
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

const OUTCOME: Record<AuditOutcome, { label: string; tone: BadgeTone }> = {
  success: { label: "Success", tone: "success" },
  error: { label: "Error", tone: "danger" },
  denied: { label: "Denied", tone: "violet" },
};

export function OutcomeBadge({ outcome }: { outcome: AuditOutcome }) {
  const { label, tone } = OUTCOME[outcome];
  return <Badge tone={tone}>{label}</Badge>;
}

const SOURCE: Record<AuditSource, string> = { mcp: "MCP", rest: "REST", chat: "Chat" };

export function SourceLabel({ source }: { source: AuditSource }) {
  return <span className="font-mono text-xs text-zinc-500">{SOURCE[source]}</span>;
}
