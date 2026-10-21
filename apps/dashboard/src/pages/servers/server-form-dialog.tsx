import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { FormAlert } from "@/pages/auth/auth-layout";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { FieldError, Input, Label } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { errorMessage, isApiError } from "@/lib/api";
import { useCreateServer, useUpdateServer } from "@/lib/queries";
import type { AdminServer, AuthType, ServerPatch } from "@/lib/types";
import { cn } from "@/lib/utils";

// Mirrors the gateway's validation (apps/gateway/src/routes/admin.ts).
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_HEADERS = new Set([
  "accept", "connection", "content-length", "content-type", "host",
  "mcp-protocol-version", "mcp-session-id", "transfer-encoding",
]);

const formSchema = z
  .object({
    slug: z.string().max(32, "At most 32 characters").regex(SLUG_PATTERN, "Lowercase letters, digits and single hyphens"),
    name: z.string().trim().min(1, "Enter a display name").max(100),
    url: z
      .url({ protocol: /^https?$/, message: "Enter an http(s) URL, e.g. http://host:3001/mcp" })
      .max(2048),
    authType: z.enum(["none", "bearer", "header"]),
    authHeaderName: z.string(),
    // Pasted tokens often carry stray whitespace, which upstreams reject.
    secret: z.string().trim().max(4096),
    secretRequired: z.boolean(),
    adminOnlyTools: z.array(z.string()),
  })
  .superRefine((value, ctx) => {
    if (value.authType === "header") {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(value.authHeaderName)) {
        ctx.addIssue({ code: "custom", path: ["authHeaderName"], message: "Letters, digits and hyphens only" });
      } else if (RESERVED_HEADERS.has(value.authHeaderName.toLowerCase())) {
        ctx.addIssue({ code: "custom", path: ["authHeaderName"], message: "This header is reserved by the gateway" });
      }
    }

    if (value.secretRequired && !value.secret) {
      ctx.addIssue({ code: "custom", path: ["secret"], message: "Enter the credential the upstream expects" });
    }
  });

type FieldName = "slug" | "name" | "url" | "authHeaderName" | "secret";
type Errors = Partial<Record<FieldName, string>>;
type SecretMode = "keep" | "replace";

const AUTH_OPTIONS: Array<{ value: AuthType; label: string; hint: string }> = [
  { value: "none", label: "None", hint: "Upstream needs no credential" },
  { value: "bearer", label: "Bearer token", hint: "Sent as Authorization: Bearer …" },
  { value: "header", label: "Custom header", hint: "Sent in a header you name" },
];

function parseToolList(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).map((t) => t.trim()).filter(Boolean))];
}

// One form for register (no `server`) and edit. Stored secrets are never
// returned by the gateway, so the edit form can only keep, replace or (by
// switching auth to None) clear the credential.
export function ServerFormDialog({
  open,
  onOpenChange,
  server,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  server?: AdminServer;
  onSaved?: (server: AdminServer) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <ServerForm server={server} onClose={() => onOpenChange(false)} onSaved={onSaved} />}
    </Dialog>
  );
}

function ServerForm({
  server,
  onClose,
  onSaved,
}: {
  server?: AdminServer;
  onClose: () => void;
  onSaved?: (server: AdminServer) => void;
}) {
  const editing = !!server;
  const create = useCreateServer();
  const update = useUpdateServer();
  const mutation = editing ? update : create;

  const [slug, setSlug] = useState(server?.slug ?? "");
  const [name, setName] = useState(server?.name ?? "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [authType, setAuthType] = useState<AuthType>(server?.authType ?? "none");
  const [authHeaderName, setAuthHeaderName] = useState(server?.authHeaderName ?? "");
  const [secret, setSecret] = useState("");
  const [secretMode, setSecretMode] = useState<SecretMode>(server?.hasCredential ? "keep" : "replace");
  const [enabled, setEnabled] = useState(server?.enabled ?? true);
  const [adminOnly, setAdminOnly] = useState<string[]>(server?.adminOnlyTools ?? []);
  const [adminOnlyText, setAdminOnlyText] = useState((server?.adminOnlyTools ?? []).join(", "));
  const [errors, setErrors] = useState<Errors>({});

  const discovered = server?.tools.map((t) => t.name) ?? [];
  // Admin-only names configured before the tool was discovered stay selectable.
  const toolChoices = [...new Set([...discovered, ...(server?.adminOnlyTools ?? [])])];
  const useCheckboxes = toolChoices.length > 0;

  // A stored credential can be kept only while the auth type is unchanged.
  const canKeepSecret = editing && server.hasCredential && authType === server.authType && authType !== "none";
  const effectiveMode: SecretMode = canKeepSecret ? secretMode : "replace";
  const willClearSecret = editing && server.hasCredential && authType === "none";

  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) {
      return;
    }

    const tools = useCheckboxes ? adminOnly : parseToolList(adminOnlyText);
    const parsed = formSchema.safeParse({
      slug: editing ? server.slug : slug.trim(),
      name,
      url: url.trim(),
      authType,
      authHeaderName: authHeaderName.trim(),
      secret,
      secretRequired: authType !== "none" && effectiveMode === "replace",
      adminOnlyTools: tools,
    });

    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }

    setErrors({});
    const v = parsed.data;
    const authHeader = v.authType === "header" ? v.authHeaderName : null;
    // undefined keeps the stored secret, null clears it, a string replaces it.
    const authSecret = v.authType === "none" ? null : effectiveMode === "replace" ? v.secret : undefined;

    const onSuccess = (saved: AdminServer) => {
      toast.success(
        editing ? `Saved ${saved.name}` : `Registered ${saved.name}`,
        saved.status === "unreachable" ? { description: "Saved, but the gateway cannot reach it yet." } : undefined,
      );
      onSaved?.(saved);
      onClose();
    };

    if (editing) {
      const patch: ServerPatch = {
        name: v.name,
        url: v.url,
        authType: v.authType,
        authHeaderName: authHeader,
        adminOnlyTools: v.adminOnlyTools,
        ...(authSecret === undefined || (authSecret === null && !server.hasCredential) ? {} : { authSecret }),
      };
      update.mutate({ slug: server.slug, patch }, { onSuccess });
    } else {
      create.mutate(
        {
          slug: v.slug,
          name: v.name,
          url: v.url,
          authType: v.authType,
          authHeaderName: authHeader,
          authSecret: authSecret ?? null,
          enabled,
          adminOnlyTools: v.adminOnlyTools,
        },
        {
          onSuccess,
          onError: (error) => {
            if (isApiError(error, 409)) {
              setErrors({ slug: "A server with this slug already exists" });
            }
          },
        },
      );
    }
  }

  const failure = mutation.error && !isApiError(mutation.error, 409) ? errorMessage(mutation.error) : null;

  return (
    <DialogContent
      title={editing ? `Edit ${server.name}` : "Register MCP server"}
      description={
        editing
          ? "Changes apply immediately and the gateway re-checks the connection."
          : "Add an upstream that speaks MCP over Streamable HTTP. The gateway connects to it with its own credential."
      }
      // Avoid losing a half-filled form to a stray click outside.
      onInteractOutside={(event) => event.preventDefault()}
    >
      <form onSubmit={submit} noValidate>
        <DialogBody>
          <FormAlert>{failure}</FormAlert>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="server-name">Display name</Label>
              <Input
                id="server-name"
                autoFocus
                placeholder="WooCommerce Store"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={!!errors.name || undefined}
              />
              <FieldError>{errors.name}</FieldError>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="server-slug">Slug</Label>
              <Input
                id="server-slug"
                className="font-mono"
                placeholder="woocommerce"
                value={editing ? server.slug : slug}
                onChange={(e) => setSlug(e.target.value.toLowerCase())}
                disabled={editing}
                aria-invalid={!!errors.slug || undefined}
                aria-describedby="server-slug-hint"
              />
              {errors.slug ? (
                <FieldError id="server-slug-hint">{errors.slug}</FieldError>
              ) : (
                <p id="server-slug-hint" className="text-xs text-zinc-500">
                  {editing ? "Fixed: tools are exposed as " : "Tools are exposed as "}
                  <span className="font-mono">{(editing ? server.slug : slug) || "slug"}__tool</span>
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="server-url">Streamable HTTP endpoint</Label>
            <Input
              id="server-url"
              type="url"
              className="font-mono"
              placeholder="http://localhost:3001/mcp"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              aria-invalid={!!errors.url || undefined}
            />
            <FieldError>{errors.url}</FieldError>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">Upstream authentication</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {AUTH_OPTIONS.map((option) => (
                <label
                  key={option.value}
                  className={cn(
                    "flex cursor-pointer flex-col rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-indigo-500",
                    authType === option.value ? "border-indigo-500 bg-indigo-50/50" : "border-zinc-200 hover:bg-zinc-50",
                  )}
                >
                  <input
                    type="radio"
                    name="auth-type"
                    value={option.value}
                    checked={authType === option.value}
                    onChange={() => setAuthType(option.value)}
                    className="sr-only"
                  />
                  <span className="text-sm font-medium text-zinc-900">{option.label}</span>
                  <span className="text-xs text-zinc-500">{option.hint}</span>
                </label>
              ))}
            </div>
            {willClearSecret && (
              <p className="text-xs text-amber-700">The stored credential will be removed when you save.</p>
            )}
          </fieldset>

          {authType === "header" && (
            <div className="space-y-1.5">
              <Label htmlFor="server-header">Header name</Label>
              <Input
                id="server-header"
                className="font-mono"
                placeholder="X-Api-Key"
                value={authHeaderName}
                onChange={(e) => setAuthHeaderName(e.target.value)}
                aria-invalid={!!errors.authHeaderName || undefined}
              />
              <FieldError>{errors.authHeaderName}</FieldError>
            </div>
          )}

          {authType !== "none" && (
            <div className="space-y-2">
              {canKeepSecret && (
                <div role="radiogroup" aria-label="Stored credential" className="flex flex-wrap gap-4 text-sm">
                  {(["keep", "replace"] as const).map((mode) => (
                    <label key={mode} className="flex cursor-pointer items-center gap-2 text-zinc-700">
                      <input
                        type="radio"
                        name="secret-mode"
                        checked={secretMode === mode}
                        onChange={() => setSecretMode(mode)}
                        className="accent-indigo-600"
                      />
                      {mode === "keep" ? "Keep stored credential" : "Replace credential"}
                    </label>
                  ))}
                </div>
              )}
              {effectiveMode === "replace" && (
                <div className="space-y-1.5">
                  <Label htmlFor="server-secret">{authType === "bearer" ? "Bearer token" : "Header value"}</Label>
                  <Input
                    id="server-secret"
                    type="password"
                    autoComplete="off"
                    className="font-mono"
                    value={secret}
                    onChange={(e) => setSecret(e.target.value)}
                    aria-invalid={!!errors.secret || undefined}
                    aria-describedby="server-secret-hint"
                  />
                  {errors.secret ? (
                    <FieldError id="server-secret-hint">{errors.secret}</FieldError>
                  ) : (
                    <p id="server-secret-hint" className="text-xs text-zinc-500">
                      Stored on the gateway only. It is never shown again or sent to MCP clients.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-zinc-800">Admin-only tools</legend>
            <p className="text-xs text-zinc-500">Hidden from members and rejected if they call them (e.g. write tools).</p>
            {useCheckboxes ? (
              <div className="grid max-h-40 gap-1.5 overflow-y-auto rounded-md border border-zinc-200 p-3 sm:grid-cols-2">
                {toolChoices.map((tool) => (
                  <label key={tool} className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700">
                    <input
                      type="checkbox"
                      className="accent-indigo-600"
                      checked={adminOnly.includes(tool)}
                      onChange={(e) =>
                        setAdminOnly((current) => (e.target.checked ? [...current, tool] : current.filter((t) => t !== tool)))
                      }
                    />
                    <span className="truncate font-mono text-xs">{tool}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Input
                aria-label="Admin-only tools"
                className="font-mono"
                placeholder="create_product, update_order_status"
                value={adminOnlyText}
                onChange={(e) => setAdminOnlyText(e.target.value)}
              />
            )}
          </fieldset>

          {!editing && (
            <div className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2.5">
              <div>
                <Label htmlFor="server-enabled">Enabled</Label>
                <p className="text-xs text-zinc-500">Disabled servers keep their settings but expose no tools.</p>
              </div>
              <Switch id="server-enabled" label="Enabled" checked={enabled} onCheckedChange={setEnabled} />
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary" disabled={mutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" loading={mutation.isPending}>
            {editing ? "Save changes" : "Register server"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
