import type { InputHTMLAttributes, LabelHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-9 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm transition-colors placeholder:text-zinc-400",
        "focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/20",
        "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60",
        "aria-invalid:border-red-500 aria-invalid:ring-red-500/20",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-sm font-medium text-zinc-800", className)} {...props} />;
}

export function FieldError({ id, children }: { id?: string; children?: string }) {
  if (!children) {
    return null;
  }

  return (
    <p id={id} className="text-xs text-red-600">
      {children}
    </p>
  );
}
