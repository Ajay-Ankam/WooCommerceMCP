import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
const absolute = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
  ["second", 1],
];

// "3 minutes ago"; anything under 10 seconds reads as "just now".
export function timeAgo(iso: string, now = Date.now()): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);

  if (Math.abs(seconds) < 10) {
    return "just now";
  }

  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return relative.format(Math.round(seconds / size), unit);
    }
  }

  return "just now";
}

export function formatDateTime(iso: string): string {
  return absolute.format(new Date(iso));
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

// Gateway tool names are "<server-slug>__<tool>" (see gateway mcp/tool-names).
export function splitToolName(name: string): { server: string; tool: string } {
  const index = name.indexOf("__");
  return index > 0 ? { server: name.slice(0, index), tool: name.slice(index + 2) } : { server: "", tool: name };
}
