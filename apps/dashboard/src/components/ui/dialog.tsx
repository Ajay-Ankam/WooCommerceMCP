import { X } from "lucide-react";
import { Dialog as RadixDialog } from "radix-ui";
import type { HTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Dialog = RadixDialog.Root;
export const DialogClose = RadixDialog.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  onInteractOutside,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  onInteractOutside?: (event: Event) => void;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/40" />
      <RadixDialog.Content
        onInteractOutside={onInteractOutside}
        className={cn(
          "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-zinc-200 bg-white shadow-xl focus:outline-none",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-zinc-100 px-5 py-4">
          <div className="min-w-0">
            <RadixDialog.Title className="text-base font-semibold text-zinc-900">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-zinc-500">{description}</RadixDialog.Description>
            ) : (
              <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
            )}
          </div>
          <RadixDialog.Close asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close">
              <X aria-hidden />
            </Button>
          </RadixDialog.Close>
        </div>
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-4 px-5 py-4", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 border-t border-zinc-100 px-5 py-3 sm:flex-row sm:justify-end", className)}
      {...props}
    />
  );
}
