import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
  {
    variants: {
      tone: {
        neutral: "bg-zinc-50 text-zinc-600 ring-zinc-200",
        success: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
        warning: "bg-amber-50 text-amber-800 ring-amber-600/20",
        danger: "bg-red-50 text-red-700 ring-red-600/20",
        accent: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
        violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export type BadgeTone = NonNullable<VariantProps<typeof badgeVariants>["tone"]>;

const DOT: Record<BadgeTone, string> = {
  neutral: "bg-zinc-400",
  success: "bg-emerald-500",
  warning: "bg-amber-500",
  danger: "bg-red-500",
  accent: "bg-indigo-500",
  violet: "bg-violet-500",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

export function Badge({ className, tone, dot, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot && <span className={cn("size-1.5 rounded-full", DOT[tone ?? "neutral"])} aria-hidden />}
      {children}
    </span>
  );
}
