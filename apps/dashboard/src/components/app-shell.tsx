import {
  ChevronDown,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  ScrollText,
  Server,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DropdownMenu } from "radix-ui";
import { Suspense, useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

import { useCurrentUser } from "@/auth/guards";
import { ErrorBoundary } from "@/components/error-boundary";
import { PageSkeleton } from "@/components/page";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { useLogout } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

const WORKSPACE_NAV: NavItem[] = [
  { to: "/", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/servers", label: "MCP servers", icon: Server },
  { to: "/chat", label: "AI chat", icon: MessageSquare },
  { to: "/keys", label: "API keys", icon: KeyRound },
  { to: "/audit", label: "Audit log", icon: ScrollText },
];

const ADMIN_NAV: NavItem[] = [
  { to: "/team", label: "Team", icon: Users },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/favicon.svg" alt="" className="size-7" />
      <div className="leading-tight">
        <p className="text-sm font-semibold text-zinc-900">URUMI</p>
        <p className="text-xs text-zinc-500">MCP Gateway</p>
      </div>
    </div>
  );
}

function NavSection({ title, items, onNavigate }: { title?: string; items: NavItem[]; onNavigate?: () => void }) {
  return (
    <div>
      {title && <p className="mb-1 px-3 text-xs font-medium uppercase tracking-wide text-zinc-400">{title}</p>}
      <ul className="space-y-0.5">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink
              to={to}
              end={end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
                  isActive ? "bg-indigo-50 text-indigo-700" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
                )
              }
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              {label}
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const isAdmin = useCurrentUser().role === "admin";

  return (
    <nav aria-label="Main" className="flex flex-col gap-6">
      <NavSection items={WORKSPACE_NAV} onNavigate={onNavigate} />
      {isAdmin && <NavSection title="Admin" items={ADMIN_NAV} onNavigate={onNavigate} />}
    </nav>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

function UserMenu() {
  const user = useCurrentUser();
  const logout = useLogout();
  const navigate = useNavigate();

  function signOut() {
    logout.mutate(undefined, {
      onError: (error) => toast.error(errorMessage(error)),
      onSettled: () => navigate("/login", { replace: true }),
    });
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <span className="flex size-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white" aria-hidden>
            {initials(user.name) || "?"}
          </span>
          <span className="hidden text-sm font-medium text-zinc-900 sm:block">{user.name}</span>
          <ChevronDown className="size-4 text-zinc-400" aria-hidden />
          <span className="sr-only">Account menu</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 w-64 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg"
        >
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium text-zinc-900">{user.name}</p>
            <p className="truncate text-xs text-zinc-500">{user.email}</p>
            <Badge tone={user.role === "admin" ? "accent" : "neutral"} className="mt-2 capitalize">
              {user.role}
            </Badge>
          </div>
          <DropdownMenu.Separator className="my-1 h-px bg-zinc-100" />
          <DropdownMenu.Item
            onSelect={signOut}
            disabled={logout.isPending}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-700 outline-none data-[highlighted]:bg-zinc-100 data-[highlighted]:text-zinc-900"
          >
            <LogOut className="size-4" aria-hidden /> Log out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation">
          <Menu aria-hidden />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-zinc-900/30 lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col gap-6 border-r border-zinc-200 bg-white p-4 shadow-xl focus:outline-none lg:hidden">
          <div className="flex items-center justify-between">
            <Brand />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close navigation">
                <X aria-hidden />
              </Button>
            </Dialog.Close>
          </div>
          <Dialog.Title className="sr-only">Navigation</Dialog.Title>
          <Dialog.Description className="sr-only">Dashboard sections</Dialog.Description>
          <SidebarNav onNavigate={() => setOpen(false)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AppShell() {
  const { pathname } = useLocation();

  // Move focus to the top of new content for keyboard and screen-reader users.
  useEffect(() => {
    document.getElementById("main")?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:ring-2 focus:ring-indigo-500"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r border-zinc-200 bg-white px-3 py-4 lg:flex">
        <Brand />
        <SidebarNav />
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-zinc-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <MobileNav />
          <div className="lg:hidden">
            <Brand />
          </div>
          <div className="ml-auto">
            <UserMenu />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 focus:outline-none sm:px-6 lg:px-8">
          <ErrorBoundary key={pathname}>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
