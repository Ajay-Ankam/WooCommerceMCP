import { AlertTriangle, KeyRound, Link2, MoreHorizontal, Shield, Trash2, UserPlus, Users } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { useCurrentUser } from "@/auth/guards";
import { CopyButton } from "@/components/copy-button";
import { EmptyState, ErrorState, PageHeader } from "@/components/page";
import { FormAlert } from "@/pages/auth/auth-layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage, isApiError } from "@/lib/api";
import {
  useAdminRevokeKey,
  useInviteUser,
  useReissueInvite,
  useRemoveUser,
  useUpdateRole,
  useUsers,
} from "@/lib/queries";
import type { ApiKeySummary, InviteResult, Role, UserDetails } from "@/lib/types";
import { cn, formatDateTime, timeAgo } from "@/lib/utils";

const inviteSchema = z.object({
  name: z.string().trim().min(1, "Enter their name").max(100, "At most 100 characters"),
  email: z.email("Enter a valid email address").max(254),
  role: z.enum(["admin", "member"]),
});

type InviteField = "name" | "email";

const ROLE_OPTIONS: Array<{ value: Role; label: string; hint: string }> = [
  { value: "member", label: "Member", hint: "Uses tools and manages their own keys" },
  { value: "admin", label: "Admin", hint: "Also manages servers, team and audit" },
];

const menuItem =
  "flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900";

function RoleBadge({ role }: { role: Role }) {
  return role === "admin" ? <Badge tone="accent">Admin</Badge> : <Badge>Member</Badge>;
}

// Active once a password is set; until then the account only has an invite.
function AccountStatus({ user }: { user: UserDetails }) {
  if (user.hasPassword) {
    return (
      <Badge tone="success" dot>
        Active
      </Badge>
    );
  }

  return user.invitePending ? (
    <Badge tone="warning" dot>
      Invite pending
    </Badge>
  ) : (
    <Badge>No access</Badge>
  );
}

// Shown once after inviting or re-issuing. The gateway stores only a hash of
// the token, so the link cannot be displayed again.
function InviteLink({ result }: { result: InviteResult }) {
  const link = `${window.location.origin}${result.invitePath}`;

  return (
    <>
      <div role="alert" className="flex gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <p className="text-sm text-amber-900">
          Send this link to {result.user.name} privately. It is shown only once, works a single time and expires in{" "}
          {result.expiresInHours} hours.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="invite-link">Invite link for {result.user.email}</Label>
        <div className="flex gap-2">
          <Input
            id="invite-link"
            readOnly
            value={link}
            className="font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <CopyButton value={link} label="Copy link" showLabel className="h-9" />
        </div>
      </div>
    </>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const invite = useInviteUser();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [errors, setErrors] = useState<Partial<Record<InviteField, string>>>({});
  const result = invite.data;

  function close(next: boolean) {
    if (!next) {
      invite.reset();
      setName("");
      setEmail("");
      setRole("member");
      setErrors({});
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (invite.isPending) {
      return;
    }

    const parsed = inviteSchema.safeParse({ name, email: email.trim(), role });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }

    setErrors({});
    invite.mutate(parsed.data, {
      onError: (error) => {
        if (isApiError(error, 409)) {
          setErrors({ email: "Someone with this email is already on the team" });
        }
      },
    });
  }

  const failure = invite.error && !isApiError(invite.error, 409) ? errorMessage(invite.error) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      {open && (
        <DialogContent
          title={result ? "Share the invite link" : "Invite a team member"}
          description={result ? undefined : "They set their own password from the invite link. No email is sent."}
          onInteractOutside={(event) => event.preventDefault()}
        >
          {result ? (
            <>
              <DialogBody>
                <InviteLink result={result} />
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button>Done</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <DialogBody>
                <FormAlert>{failure}</FormAlert>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-name">Name</Label>
                  <Input
                    id="invite-name"
                    autoFocus
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    aria-invalid={!!errors.name || undefined}
                  />
                  <FieldError>{errors.name}</FieldError>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email">Email</Label>
                  <Input
                    id="invite-email"
                    type="email"
                    autoComplete="off"
                    placeholder="name@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    aria-invalid={!!errors.email || undefined}
                  />
                  <FieldError>{errors.email}</FieldError>
                </div>
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium text-zinc-800">Role</legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ROLE_OPTIONS.map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          "flex cursor-pointer flex-col rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500",
                          role === option.value ? "border-indigo-500 bg-indigo-50/50" : "border-zinc-200 hover:bg-zinc-50",
                        )}
                      >
                        <input
                          type="radio"
                          name="invite-role"
                          value={option.value}
                          checked={role === option.value}
                          onChange={() => setRole(option.value)}
                          className="sr-only"
                        />
                        <span className="text-sm font-medium text-zinc-900">{option.label}</span>
                        <span className="text-xs text-zinc-500">{option.hint}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </DialogBody>
              <DialogFooter>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={invite.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button type="submit" loading={invite.isPending}>
                  Create invite
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      )}
    </Dialog>
  );
}

// Only offered for accounts without a password: a new invite replaces the old one.
function ReissueDialog({ user, onClose }: { user: UserDetails | null; onClose: () => void }) {
  const reissue = useReissueInvite();
  const result = reissue.data;

  function close(next: boolean) {
    if (!next) {
      reissue.reset();
      onClose();
    }
  }

  return (
    <Dialog open={!!user} onOpenChange={close}>
      {user && (
        <DialogContent
          title={result ? "Share the new invite link" : `New invite link for ${user.name}?`}
          description={result ? undefined : "Any earlier invite link for this account stops working."}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogBody>
            {result ? (
              <InviteLink result={result} />
            ) : (
              <FormAlert>{reissue.error ? errorMessage(reissue.error) : null}</FormAlert>
            )}
          </DialogBody>
          <DialogFooter>
            {result ? (
              <DialogClose asChild>
                <Button>Done</Button>
              </DialogClose>
            ) : (
              <>
                <DialogClose asChild>
                  <Button variant="secondary" disabled={reissue.isPending}>
                    Cancel
                  </Button>
                </DialogClose>
                <Button loading={reissue.isPending} onClick={() => reissue.mutate(user.id)}>
                  Create link
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  );
}

function RoleDialog({ user, isSelf, onClose }: { user: UserDetails | null; isSelf: boolean; onClose: () => void }) {
  const update = useUpdateRole();
  const next: Role = user?.role === "admin" ? "member" : "admin";

  return (
    <ConfirmDialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) {
          update.reset();
          onClose();
        }
      }}
      title={next === "admin" ? `Make ${user?.name ?? ""} an admin?` : `Make ${user?.name ?? ""} a member?`}
      description={
        next === "admin"
          ? "Admins can manage servers, the team and API keys, read the full audit log and call admin-only tools."
          : isSelf
            ? "You will lose admin access immediately, including this page."
            : "They lose admin access immediately, including admin-only tools."
      }
      confirmLabel={next === "admin" ? "Make admin" : "Make member"}
      loading={update.isPending}
      error={update.error ? errorMessage(update.error) : null}
      onConfirm={() =>
        user &&
        update.mutate(
          { id: user.id, role: next },
          {
            onSuccess: () => {
              toast.success(`${user.name} is now ${next === "admin" ? "an admin" : "a member"}`);
              onClose();
            },
          },
        )
      }
    />
  );
}

function RemoveDialog({ user, onClose }: { user: UserDetails | null; onClose: () => void }) {
  const remove = useRemoveUser();

  return (
    <ConfirmDialog
      open={!!user}
      onOpenChange={(open) => {
        if (!open) {
          remove.reset();
          onClose();
        }
      }}
      title={`Remove ${user?.name ?? ""}?`}
      description="Their sessions end and all their API keys stop working immediately. Their audit history is kept."
      confirmLabel="Remove member"
      confirmText={user?.email}
      loading={remove.isPending}
      error={remove.error ? errorMessage(remove.error) : null}
      onConfirm={() =>
        user &&
        remove.mutate(user.id, {
          onSuccess: () => {
            toast.success(`Removed ${user.name}`);
            onClose();
          },
        })
      }
    />
  );
}

function KeysDialog({ user, onClose }: { user: UserDetails | null; onClose: () => void }) {
  const revoke = useAdminRevokeKey();
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);
  const sorted = [...(user?.keys ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt) || b.id - a.id);

  return (
    <>
      <Dialog open={!!user && !revoking} onOpenChange={(open) => !open && onClose()}>
        {user && (
          <DialogContent title={`${user.name}’s API keys`} description="Keys are shown by prefix only." className="sm:max-w-xl">
            <DialogBody>
              {sorted.length === 0 ? (
                <p className="text-sm text-zinc-500">This member has no API keys.</p>
              ) : (
                <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
                  {sorted.map((key) => (
                    <li key={key.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className={cn("truncate text-sm font-medium", key.revokedAt ? "text-zinc-400" : "text-zinc-900")}>
                          {key.name}
                        </p>
                        <p className="truncate text-xs text-zinc-500">
                          <span className="font-mono">{key.prefix}…</span> · last used{" "}
                          {key.lastUsedAt ? timeAgo(key.lastUsedAt) : "never"}
                        </p>
                      </div>
                      {key.revokedAt ? (
                        <Badge title={`Revoked ${formatDateTime(key.revokedAt)}`}>Revoked</Badge>
                      ) : (
                        <Button variant="danger-ghost" size="sm" onClick={() => setRevoking(key)}>
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="secondary">Close</Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => {
          if (!open) {
            revoke.reset();
            setRevoking(null);
          }
        }}
        title={`Revoke “${revoking?.name ?? ""}”?`}
        description={`Any client using this key as ${user?.name ?? "this member"} is rejected immediately. This cannot be undone.`}
        confirmLabel="Revoke key"
        loading={revoke.isPending}
        error={revoke.error ? errorMessage(revoke.error) : null}
        onConfirm={() =>
          revoking &&
          revoke.mutate(revoking.id, {
            onSuccess: () => {
              toast.success(`Revoked ${revoking.name}`);
              setRevoking(null);
            },
          })
        }
      />
    </>
  );
}

type Action = { kind: "role" | "reissue" | "keys" | "remove"; user: UserDetails };

function RowMenu({ user, isSelf, onAction }: { user: UserDetails; isSelf: boolean; onAction: (action: Action) => void }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${user.name}`}>
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className="z-50 w-52 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          <DropdownMenu.Item className={menuItem} onSelect={() => onAction({ kind: "role", user })}>
            <Shield className="size-4" aria-hidden /> {user.role === "admin" ? "Make member" : "Make admin"}
          </DropdownMenu.Item>
          {!user.hasPassword && (
            <DropdownMenu.Item className={menuItem} onSelect={() => onAction({ kind: "reissue", user })}>
              <Link2 className="size-4" aria-hidden /> New invite link
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item className={menuItem} onSelect={() => onAction({ kind: "keys", user })}>
            <KeyRound className="size-4" aria-hidden /> API keys
          </DropdownMenu.Item>
          {!isSelf && (
            <DropdownMenu.Item
              className={`${menuItem} text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700`}
              onSelect={() => onAction({ kind: "remove", user })}
            >
              <Trash2 className="size-4" aria-hidden /> Remove
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

// Route is wrapped in RequireAdmin; every endpoint used here is admin-only on the gateway too.
export default function TeamPage() {
  const me = useCurrentUser();
  const users = useUsers();
  const [inviting, setInviting] = useState(false);
  const [action, setAction] = useState<Action | null>(null);

  // Dialogs read the latest row, so key lists refresh after a revoke.
  const current = action ? (users.data?.find((u) => u.id === action.user.id) ?? null) : null;
  const target = (kind: Action["kind"]) => (action?.kind === kind ? current : null);
  const close = () => setAction(null);
  const admins = users.data?.filter((u) => u.role === "admin").length ?? 0;

  return (
    <>
      <PageHeader
        title="Team"
        description="Invite people, set their role and manage their access. Members can only use tools that aren’t admin-only."
        actions={
          <Button onClick={() => setInviting(true)}>
            <UserPlus aria-hidden /> Invite member
          </Button>
        }
      />

      <Card>
        {users.isPending ? (
          <div className="space-y-3 p-5" aria-busy="true" aria-label="Loading team">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : users.isError ? (
          <ErrorState error={users.error} onRetry={() => void users.refetch()} />
        ) : users.data.length === 0 ? (
          <EmptyState icon={Users} title="No team members" description="Invite someone to give them access to the gateway." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr className="border-b border-zinc-100">
                  <th scope="col" className="px-5 py-2.5 font-medium">Member</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Role</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Active keys</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Added</th>
                  <th scope="col" className="px-5 py-2.5"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {users.data.map((user) => {
                  const isSelf = user.id === me.id;
                  const activeKeys = user.keys.filter((k) => !k.revokedAt).length;
                  return (
                    <tr key={user.id} className="transition-colors hover:bg-zinc-50/60">
                      <td className="max-w-72 px-5 py-3">
                        <p className="flex items-center gap-2 truncate font-medium text-zinc-900">
                          <span className="truncate">{user.name}</span>
                          {isSelf && <Badge tone="violet">You</Badge>}
                        </p>
                        <p className="truncate text-xs text-zinc-500">{user.email}</p>
                      </td>
                      <td className="px-3 py-3">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-3 py-3">
                        <AccountStatus user={user} />
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-600">
                        {activeKeys}
                        {user.keys.length > activeKeys && (
                          <span className="ml-1 text-xs text-zinc-400">({user.keys.length - activeKeys} revoked)</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                        <time dateTime={user.createdAt} title={formatDateTime(user.createdAt)}>
                          {timeAgo(user.createdAt)}
                        </time>
                      </td>
                      <td className="px-5 py-3 text-right">
                        <RowMenu user={user} isSelf={isSelf} onAction={setAction} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {users.data && (
        <p className="mt-3 text-xs text-zinc-500">
          {users.data.length} {users.data.length === 1 ? "person" : "people"} · {admins} {admins === 1 ? "admin" : "admins"}. The
          team always keeps at least one admin.
        </p>
      )}

      <InviteDialog open={inviting} onOpenChange={setInviting} />
      <RoleDialog user={target("role")} isSelf={current?.id === me.id} onClose={close} />
      <ReissueDialog user={target("reissue")} onClose={close} />
      <KeysDialog user={target("keys")} onClose={close} />
      <RemoveDialog user={target("remove")} onClose={close} />
    </>
  );
}
