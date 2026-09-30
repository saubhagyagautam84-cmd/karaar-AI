"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, BadgeCheck, CloudOff, FileText, LogIn, LogOut, Mic, RefreshCw, TriangleAlert } from "lucide-react";
import { Logo, cn } from "./ui";
import { EasyToggle } from "./A11y";
import { DEMO_MODE, backendHealth } from "@/lib/api";
import { logoutServer } from "@/lib/account";
import { ROLE_LABEL, setSession, useSession } from "@/lib/session";
import { useAgreements } from "@/lib/store";

const NAV = [
  { href: "/new", label: "New deal", hi: "नया करार", icon: Mic },
  { href: "/deals", label: "Agreements", hi: "करार", icon: FileText },
  { href: "/profile", label: "Trust profile", hi: "प्रोफ़ाइल", icon: BadgeCheck },
  { href: "/dashboard", label: "Dashboard", hi: "डैशबोर्ड", icon: BarChart3 },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const active = (href: string) => path === href || path.startsWith(href + "/");
  const [live, setLive] = useState<null | { ok: boolean; simulated: number }>(null);
  const session = useSession();
  const { online, pending, syncError } = useAgreements();
  useEffect(() => {
    if (DEMO_MODE) return;
    backendHealth().then((h) => setLive(h ? { ok: true, simulated: h.simulated.length } : { ok: false, simulated: 0 }));
  }, []);
  return (
    <div className="min-h-dvh pb-24 md:pb-10">
      <header className="no-print sticky top-0 z-30 border-b border-line/70 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link href="/" aria-label="Karaar AI home">
            <Logo size={32} />
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition",
                  active(n.href) ? "bg-cream text-navy" : "text-navy-muted hover:text-navy",
                )}
              >
                <n.icon size={17} />
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
          <EasyToggle className="hidden sm:flex" />
          {session ? (
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-bold text-navy"
              title={`Signed in as ${ROLE_LABEL[session.role].en} (+91 ${session.phone}). Tap to sign out.`}
              onClick={() => {
                void logoutServer(session);
                setSession(null);
              }}
            >
              {ROLE_LABEL[session.role].en} · {session.phone.slice(-4)} <LogOut size={13} aria-label="Sign out" />
            </button>
          ) : (
            <Link href="/login" className="flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-1 text-xs font-bold text-navy">
              <LogIn size={13} /> Sign in
            </Link>
          )}
          {DEMO_MODE && (
            <span className="rounded-full border border-saffron/40 bg-saffron-soft px-2.5 py-1 text-xs font-bold text-saffron-ink" title="AI and government APIs are simulated in the browser">
              Demo mode
            </span>
          )}
          {!DEMO_MODE && live && (
            <span
              className={cn(
                "rounded-full border px-2.5 py-1 text-xs font-bold",
                live.ok ? "border-leaf/40 bg-leaf-soft text-leaf" : "border-alert/40 bg-alert-soft text-alert",
              )}
              title={live.ok ? `Connected to the Karaar backend. ${live.simulated} government/AI services are simulated.` : "The Karaar backend is not reachable."}
            >
              {live.ok ? (live.simulated ? "Live · DPI simulated" : "Live") : "Backend offline"}
            </span>
          )}
          </div>
        </div>
      </header>

      {!DEMO_MODE && (!online || pending > 0) && (
        <div className={cn("no-print border-b px-4 py-2 text-center text-sm font-semibold", online ? "border-line bg-cream text-navy" : "border-amber-ink/20 bg-amber-soft text-amber-ink")} role="status">
          {online ? (
            <span className="inline-flex items-center gap-1.5"><RefreshCw size={14} className="animate-spin" /> Syncing {pending} change{pending === 1 ? "" : "s"}…</span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <CloudOff size={15} /> Offline · ऑफ़लाइन. Keep working: {pending ? `${pending} change${pending === 1 ? " is" : "s are"} saved on this phone and` : "changes are saved on this phone and"} will sync when you are back online.
            </span>
          )}
        </div>
      )}
      {syncError && (
        <div className="no-print border-b border-alert/20 bg-alert-soft px-4 py-2 text-center text-sm font-semibold text-alert" role="alert">
          <span className="inline-flex items-center gap-1.5"><TriangleAlert size={15} /> Not saved on the server: {syncError}</span>
        </div>
      )}

      <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">{children}</main>
      <div className="fixed bottom-20 right-3 z-30 sm:hidden">
        <EasyToggle className="shadow-card" />
      </div>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 border-t border-line bg-paper/95 backdrop-blur md:hidden" aria-label="Main">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold", active(n.href) ? "text-saffron-ink" : "text-navy-muted")}
            >
              <n.icon size={22} strokeWidth={active(n.href) ? 2.4 : 2} />
              <span>{n.label}</span>
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
