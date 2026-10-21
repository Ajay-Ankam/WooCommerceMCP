import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogClose, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";

// Confirmation for destructive actions. With `confirmText`, the user must type
// it (e.g. a server slug) before the action button enables.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  confirmText,
  loading,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  confirmText?: string;
  loading?: boolean;
  error?: string | null;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const ready = !confirmText || typed === confirmText;

  function change(next: boolean) {
    if (!next) {
      setTyped("");
    }
    onOpenChange(next);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (ready && !loading) {
      onConfirm();
    }
  }

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent title={title}>
        <form onSubmit={submit}>
          <DialogBody>
            <div className="text-sm text-zinc-600">{description}</div>
            {confirmText && (
              <div className="space-y-1.5">
                <Label htmlFor="confirm-text">
                  Type <span className="font-mono text-zinc-900">{confirmText}</span> to confirm
                </Label>
                <Input id="confirm-text" autoComplete="off" autoFocus value={typed} onChange={(e) => setTyped(e.target.value)} />
              </div>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary">Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="danger" disabled={!ready} loading={loading}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
