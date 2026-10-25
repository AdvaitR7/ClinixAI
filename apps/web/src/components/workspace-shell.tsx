"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";
import { useAuth } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
};

/** Provides account access and sign-out in the original workspace header. */
function AccountMenu() {
  const { user, signOut } = useAuth();
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
      <summary aria-label="Account options" className="grid size-[38px] cursor-pointer list-none place-items-center rounded-full font-sans text-sm font-bold text-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-evidence">
        {initial}
      </summary>
      <div className="absolute right-0 top-12 z-50 w-64 rounded-2xl border border-sage bg-surface p-4 text-ink shadow-xl">
        <p className="truncate font-sans text-xs text-graphite">{user?.email ?? "Signed in"}</p>
        <Link href="/settings" className="mt-4 block rounded-xl px-3 py-2 font-sans text-sm font-medium hover:bg-canvas">Account settings</Link>
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
}: {
  workspace: string;
  title: string;
  nav: NavItem[];
  children: ReactNode;
}) {
  const doctor = workspace.toLowerCase().includes("doctor");

  return (
    <div className={`min-h-dvh ${doctor ? "bg-ink text-surface" : "bg-canvas text-ink"}`}>
      <header
        className={`mx-auto flex w-full max-w-[87.5rem] items-center justify-between px-6 pb-3 pt-5 ${
          doctor ? "bg-ink" : "bg-canvas"
        }`}
      >
        <ClinixBrand inverted={doctor} />
        <div className="flex items-center gap-2">
          <span
            aria-hidden="true"
            className={`grid size-[38px] place-items-center rounded-full border ${
              doctor
                ? "border-copper text-copper"
                : "border-sage bg-surface text-botanical"
            }`}
          >
            <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" />
              <path d="M10 21h4" />
            </svg>
          </span>
          <span className={`grid size-[38px] place-items-center rounded-full ${doctor ? "bg-copper" : "bg-botanical"}`}>
            <AccountMenu />
          </span>
        </div>
      </header>

      <div className="mx-auto w-full max-w-[87.5rem] px-6 pt-2">
        <p className={`clinix-label ${doctor ? "text-copper" : "text-graphite"}`}>
          {workspace} workspace
        </p>
        <h1 className={`mt-1 font-sans text-[1.75rem] font-bold leading-tight tracking-[-0.04em] ${doctor ? "text-surface" : "text-ink"}`}>
          {title}
        </h1>
      </div>

      <main className="mx-auto w-full max-w-[87.5rem] space-y-6 px-6 pb-28 pt-6 md:pb-10">
        {children}
      </main>

      <nav
        aria-label={`${workspace} workspace`}
        className={`fixed inset-x-6 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 mx-auto max-w-[34rem] rounded-[1.5rem] border p-1 shadow-[0_12px_36px_rgba(0,0,0,0.18)] md:sticky md:inset-x-auto md:bottom-4 ${
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
      </nav>
    </div>
  );
}
