import type { ReactNode } from "react";

export function AuthLayout({ title, description, children }: { title: string; description: ReactNode; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/favicon.svg" alt="" className="mb-4 size-10" />
          <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{title}</h1>
          <p className="mt-1.5 text-sm text-zinc-500">{description}</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-white p-6 shadow-sm">{children}</div>
        <p className="mt-6 text-center text-xs text-zinc-400">URUMI MCP Gateway</p>
      </div>
    </main>
  );
}

export function FormAlert({ children }: { children?: string | null }) {
  if (!children) {
    return null;
  }

  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
      {children}
    </div>
  );
}
