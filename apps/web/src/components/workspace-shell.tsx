"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";
import { ConnectionStatus } from "@/components/connection-status";
import { useInstallState } from "@/components/install-app";
import { NotificationBell } from "@/components/notification-bell";
import { useAuth } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
};

/** Provides account access and sign-out in the original workspace header. */
export function AccountMenu() {
  const { user, signOut } = useAuth();
  const install = useInstallState();
  const [error, setError] = useState<string | null>(null);
  const initial = user?.email?.slice(0, 1).toUpperCase() ?? "•";

  async function handleSignOut() {
    setError(null);
    try {
      await signOut();
    } catch {
      setError("Could not sign out. Try again.");
    }
  }

  return (
    <details className="relative">
      <summary aria-label="Account options" className="grid size-11 cursor-pointer list-none place-items-center rounded-full font-sans text-sm font-bold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evidence">
        {initial}
      </summary>
      <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-sage bg-surface p-4 text-ink shadow-xl">
        <p className="truncate font-sans text-xs text-graphite">{user?.email ?? "Signed in"}</p>
        <Link href="/settings" className="mt-4 block rounded-xl px-3 py-2 font-sans text-sm font-medium hover:bg-canvas">Account settings</Link>
        {install.available && <Link href="/settings#install" className="block rounded-xl px-3 py-2 font-sans text-sm font-medium hover:bg-canvas">Install CliniX</Link>}
        <Link href="/forgot-password" className="block rounded-xl px-3 py-2 font-sans text-sm font-medium hover:bg-canvas">Change password</Link>
        {error && <p role="alert" className="mt-2 font-sans text-xs text-critical">{error}</p>}
        <button type="button" onClick={() => void handleSignOut()} className="mt-2 w-full rounded-xl px-3 py-2 text-left font-sans text-sm font-semibold text-critical hover:bg-canvas">Sign out</button>
      </div>
    </details>
  );
}

/** Draws the compact workspace navigation icon that matches each label. */
function NavIcon({ label }: { label: string }) {
  const common = {
    viewBox: "0 0 24 24",
    className: "size-[18px]",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (/home|desk/i.test(label)) {
    return (
      <svg {...common}>
        <path d="m3.5 10 8.5-7 8.5 7" />
        <path d="M5.5 9v11h13V9M9.5 20v-6h5v6" />
      </svg>
    );
  }
  if (/patient|care|you/i.test(label)) {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.5" />
        <path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" />
      </svg>
    );
  }
  if (/vault|report|draft/i.test(label)) {
    return (
      <svg {...common}>
        <path d="M6 3.5h9l3 3V20H6z" />
        <path d="M15 3.5V7h3M9 11h6M9 15h6" />
      </svg>
    );
  }
  if (/visit|schedule|timeline/i.test(label)) {
    return (
      <svg {...common}>
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M8 3v4M16 3v4M3.5 9.5h17" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}

/** Role-aware application shell, preserving the original caller contract. */
export function WorkspaceShell({
  workspace,
  title,
  nav,
  children,
  focused = false,
  hideHeading = false,
  hideNavigation = false,
  headerAction,
  headerContent,
  flowNavigation = false,
}: {
  workspace: string;
  title: string;
  nav: NavItem[];
  children: ReactNode;
  focused?: boolean;
  hideHeading?: boolean;
  hideNavigation?: boolean;
  headerAction?: ReactNode;
  headerContent?: ReactNode;
  flowNavigation?: boolean;
}) {
  const doctor = workspace.toLowerCase().includes("doctor");
  const width = focused ? "max-w-[393px]" : "max-w-[87.5rem]";

  return (
    <div className={`min-h-dvh ${doctor ? "bg-ink text-surface" : "bg-canvas text-ink"}`}>
      <header
        className={`mx-auto flex w-full ${width} items-center justify-between px-6 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))] ${
          doctor ? "bg-ink" : "bg-canvas"
        }`}
      >
        {headerContent ?? <>
        <ClinixBrand inverted={doctor} monogram={focused} />
        {headerAction ?? <div className="flex items-center gap-2">
          <NotificationBell doctor={doctor} />
          <span className={`grid size-11 place-items-center rounded-full ${doctor ? "bg-copper" : "bg-botanical"}`}>
            <AccountMenu />
          </span>
        </div>}
        </>}
      </header>

      <ConnectionStatus className={`mx-auto w-full ${width}`} />

      {!hideHeading && <div className={`mx-auto w-full ${width} px-6 pt-2`}>
        <p className={`clinix-label ${doctor ? "text-copper" : "text-graphite"}`}>
          {workspace} workspace
        </p>
        <h1 className={`mt-1 font-sans text-[1.75rem] font-bold leading-tight tracking-[-0.04em] ${doctor ? "text-surface" : "text-ink"}`}>
          {title}
        </h1>
      </div>}

      <main className={`mx-auto w-full ${width} space-y-6 px-6 pt-6 ${flowNavigation ? "pb-6" : "pb-28 md:pb-10"}`}>
        {children}
      </main>

      {!hideNavigation && <nav
        aria-label={`${workspace} workspace`}
        className={`${flowNavigation ? "mx-auto mb-6 w-[calc(100%_-_3rem)] max-w-[345px]" : "fixed inset-x-6 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-[34rem] md:sticky md:inset-x-auto md:bottom-4"} rounded-[1.5rem] border p-1 shadow-[0_12px_36px_rgba(0,0,0,0.18)] ${
          doctor
            ? "border-white/10 bg-doctor-panel"
            : "border-botanical/10 bg-botanical"
        }`}
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          {nav.map((item) => (
            <li key={item.label} className="min-w-0">
              {item.disabled ? (
                <span
                  aria-disabled="true"
                  className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[1.125rem] px-1 font-sans text-[9px] ${
                    doctor ? "text-doctor-muted/35" : "text-surface/35"
                  }`}
                >
                  <NavIcon label={item.label} />
                  <span className="max-w-full truncate">{item.label}</span>
                </span>
              ) : (
                <Link
                  href={item.href}
                  aria-current={item.active ? "page" : undefined}
                  className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-[1.125rem] px-1 font-sans text-[9px] font-medium transition-colors ${
                    item.active
                      ? doctor
                        ? "bg-copper text-ink"
                        : "bg-surface text-botanical"
                      : doctor
                        ? "text-doctor-muted/80 hover:text-surface"
                        : "text-surface/80 hover:text-surface"
                  }`}
                >
                  <NavIcon label={item.label} />
                  <span className="max-w-full truncate">{item.label}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>}
    </div>
  );
}
