import { toast } from "sonner";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Switch } from "@/components/ui/switch";
import { errorMessage } from "@/lib/api";
import { useDeleteServer, useUpdateServer } from "@/lib/queries";
import type { AdminServer } from "@/lib/types";

// Shows the confirmed state from the gateway rather than flipping optimistically.
export function EnabledSwitch({ server }: { server: AdminServer }) {
  const update = useUpdateServer();

  function toggle(enabled: boolean) {
    update.mutate(
      { slug: server.slug, patch: { enabled } },
      {
        onSuccess: (saved) => toast.success(`${saved.name} ${saved.enabled ? "enabled" : "disabled"}`),
        onError: (error) => toast.error(errorMessage(error)),
      },
    );
  }

  return (
    <Switch
      checked={server.enabled}
      onCheckedChange={toggle}
      disabled={update.isPending}
      label={`${server.enabled ? "Disable" : "Enable"} ${server.name}`}
    />
  );
}

export function DeleteServerDialog({
  server,
  open,
  onOpenChange,
  onDeleted,
}: {
  server: AdminServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const remove = useDeleteServer();

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          remove.reset();
        }
        onOpenChange(next);
      }}
      title={`Remove ${server.name}?`}
      description={
        <>
          Its {server.tools.length} {server.tools.length === 1 ? "tool disappears" : "tools disappear"} from the gateway for
          every user and MCP client, and the stored credential is deleted. Past audit entries are kept. To pause it
          instead, disable the server.
        </>
      }
      confirmLabel="Remove server"
      confirmText={server.slug}
      loading={remove.isPending}
      error={remove.error ? errorMessage(remove.error) : null}
      onConfirm={() =>
        remove.mutate(server.slug, {
          onSuccess: () => {
            toast.success(`Removed ${server.name}`);
            onOpenChange(false);
            onDeleted?.();
          },
        })
      }
    />
  );
}
