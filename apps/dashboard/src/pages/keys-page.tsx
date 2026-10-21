import { AlertTriangle, KeyRound, Plug, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { CopyButton } from "@/components/copy-button";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { FormAlert } from "@/pages/auth/auth-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useCreateKey, useMyKeys, useRevokeKey } from "@/lib/queries";
import type { ApiKeySummary } from "@/lib/types";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

const nameSchema = z.string().trim().min(1, "Give the key a name").max(60, "At most 60 characters");

function When({ iso, fallback }: { iso: string | null; fallback: string }) {
  return iso ? (
    <time dateTime={iso} title={formatDateTime(iso)}>
      {timeAgo(iso)}
    </time>
  ) : (
    <span className="text-zinc-400">{fallback}</span>
  );
}

// Two steps: name the key, then show the plaintext exactly once. Closing the
// dialog resets the mutation, which discards the only copy in the browser.
function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateKey();
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const issued = create.data;

  function close(next: boolean) {
    if (!next) {
      create.reset();
      setName("");
      setError(undefined);
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (create.isPending) {
      return;
    }

    const parsed = nameSchema.safeParse(name);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message);
      return;
    }

    setError(undefined);
    create.mutate(parsed.data);
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      {open && (
        <DialogContent
          title={issued ? "Copy your new API key" : "Create API key"}
          description={issued ? undefined : "Use a key to connect an MCP client or script to the gateway as you."}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {issued ? (
            <>
              <DialogBody>
                <div role="alert" className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
                  <p className="text-sm text-amber-900">
                    This is the only time the key is shown. The gateway stores only a hash, so it cannot be recovered.
                    If you lose it, revoke it and create a new one.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-key">{issued.summary.name}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="new-key"
                      readOnly
                      value={issued.key}
                      className="font-mono text-xs"
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <CopyButton value={issued.key} label="Copy key" showLabel className="h-9" />
                  </div>
                </div>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>I’ve copied the key</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <DialogBody>
                <FormAlert>{create.error ? errorMessage(create.error) : null}</FormAlert>
                <div className="space-y-1.5">
                  <Label htmlFor="key-name">Name</Label>
                  <Input
                    id="key-name"
                    autoFocus
                    autoComplete="off"
                    placeholder="e.g. Claude Desktop on laptop"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!!error || undefined}
                    aria-describedby="key-name-hint"
                  />
                  {error ? (
                    <FieldError id="key-name-hint">{error}</FieldError>
                  ) : (
                    <p id="key-name-hint" className="text-xs text-zinc-500">
                      Helps you recognise where the key is used.
                    </p>
                  )}
                </div>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={create.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" loading={create.isPending}>
                  Create key
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

function RevokeKeyDialog({ apiKey, onClose }: { apiKey: ApiKeySummary | null; onClose: () => void }) {
  const revoke = useRevokeKey();

  return (
    <ConfirmDialog
      open={!!apiKey}
      onOpenChange={(open) => {
        if (!open) {
          revoke.reset();
          onClose();
        }
      }}
      title={`Revoke “${apiKey?.name ?? ""}”?`}
      description="Any MCP client or script using this key is rejected immediately. This cannot be undone."
      confirmLabel="Revoke key"
      loading={revoke.isPending}
      error={revoke.error ? errorMessage(revoke.error) : null}
      onConfirm={() =>
        apiKey &&
        revoke.mutate(apiKey.id, {
          onSuccess: () => {
            toast.success(`Revoked ${apiKey.name}`);
            onClose();
          },
        })
      }
    />
  );
}

function ConnectCard() {
  const endpoint = `${window.location.origin}/mcp`;

  return (
    <Card className="mb-6">
      <CardHeader className="border-b-0 pb-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Plug className="size-4 text-indigo-500" aria-hidden /> Connect an MCP client
          </CardTitle>
          <CardDescription>
            One Streamable HTTP endpoint exposes every tool you can use. Send your key as a bearer token.
          </CardDescription>
        </div>
      </CardHeader>
      <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="text-xs font-medium text-zinc-500">Endpoint</dt>
          <dd className="mt-1 flex items-center gap-2">
            <span className="truncate font-mono text-sm text-zinc-900">{endpoint}</span>
            <CopyButton value={endpoint} label="Copy endpoint" />
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-medium text-zinc-500">Header</dt>
          <dd className="mt-1 truncate font-mono text-sm text-zinc-900">Authorization: Bearer &lt;your key&gt;</dd>
        </div>
      </dl>
    </Card>
  );
}

export default function KeysPage() {
  const keysQuery = useMyKeys();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);

  // Active keys first, newest first within each group.
  const sorted = [...(keysQuery.data ?? [])].sort(
    (a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || b.id - a.id,
  );

  return (
    <>
      <PageHeader
        title="API keys"
        description="Personal keys for MCP clients and scripts. Every call made with a key is audited under your account."
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> Create key
          </Button>
        }
      />

      <ConnectCard />

      <Card>
        {keysQuery.isPending ? (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading keys">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : keysQuery.isError ? (
          <ErrorState error={keysQuery.error} onRetry={() => void keysQuery.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create a key to connect Claude Desktop, Cursor or any MCP client to the gateway."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus aria-hidden /> Create key
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th scope="col" className="px-5 py-2.5 font-medium">Name</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Key</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Created</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Last used</th>
                  <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sorted.map((key) => {
                  const revoked = !!key.revokedAt;
                  return (
                    <tr key={key.id} className={cn(revoked && "text-zinc-400")}>
                      <td className={cn("max-w-56 truncate px-5 py-3 font-medium", revoked ? "text-zinc-400" : "text-zinc-900")}>
                        {key.name}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 font-mono text-xs">{key.prefix}…</td>
                      <td className="px-3 py-3">
                        {revoked ? (
                          <Badge title={key.revokedAt ? `Revoked ${formatDateTime(key.revokedAt)}` : undefined}>Revoked</Badge>
                        ) : (
                          <Badge tone="success" dot>
                            Active
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                        <When iso={key.createdAt} fallback="—" />
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                        <When iso={key.lastUsedAt} fallback="Never" />
                      </td>
                      <td className="px-5 py-3 text-right">
                        {!revoked && (
                          <Button variant="danger-ghost" size="sm" onClick={() => setRevoking(key)}>
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
      <RevokeKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} />
    </>
  );
}
