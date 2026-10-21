import { AlertTriangle, RotateCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-zinc-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-500">
        <Icon className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-zinc-900">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-zinc-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center justify-center px-6 py-10 text-center", className)}>
      <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-red-50 text-red-600">
        <AlertTriangle className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-zinc-900">Couldn’t load this data</p>
      <p className="mt-1 max-w-sm text-sm text-zinc-500">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-48" />
      <Skeleton className="mb-8 h-4 w-72" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="mt-6 h-64" />
    </div>
  );
}

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh items-center justify-center" aria-busy="true" aria-label="Loading">
      <div className="size-6 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600" />
    </div>
  );
}
