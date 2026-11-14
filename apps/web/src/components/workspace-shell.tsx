"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";
import { ConnectionStatus } from "@/components/connection-status";
import { useInstallState } from "@/components/install-app";
import { NotificationBell } from "@/components/notification-bell";
import { UiIcon, type UiIconName } from "@/components/ui-icon";
import { useAuth } from "@/lib/auth";

type NavItem = {
  label: string;
  href: string;
  active?: boolean;
  disabled?: boolean;
};

/** Provides account access and sign-out in the workspace header. */
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
      <summary aria-label="Account options" className="grid size-11 cursor-pointer list-none place-items-center rounded-full font-sans text-sm font-bold text-clear-action focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-clear-info">
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

/** Maps a nav label to the Clear icon vocabulary. */
function iconFor(label: string): UiIconName {
  if (/home|desk/i.test(label)) return "home";
  if (/patient|care|you/i.test(label)) return "user";
  if (/vault|report|draft/i.test(label)) return "file";
  if (/visit|schedule|timeline/i.test(label)) return "calendar";
  return "plus";
}

/**
 * Role-aware application shell (Clear v2): light canvas with a soft backdrop wash, glass header
 * controls and a glass dock. Callers keep the same props, destinations, account menu, bell and
 * offline banner as before; permissions never depend on this presentation.
 */
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
  const width = focused ? "max-w-[430px]" : "max-w-[87.5rem]";

  return (
    <div data-ui="clear" className="relative min-h-dvh">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[450px] overflow-hidden bg-gradient-to-b from-[#e6f0f2] to-clear-canvas"
      >
        <div className="absolute left-[180px] top-[80px] h-[290px] w-[350px] rounded-full bg-[radial-gradient(closest-side,#8fb4d0db,transparent)]" />
        <div className="absolute -left-[95px] top-[130px] h-[250px] w-[360px] rounded-full bg-[radial-gradient(closest-side,#91cac1db,transparent)]" />
      </div>

      {/* Above <main> so the account menu is never covered; below the dock (z-40). */}
      <header className={`relative z-20 mx-auto flex w-full ${width} items-center justify-between px-6 pb-3 pt-[max(1.25rem,env(safe-area-inset-top))]`}>
        {headerContent ?? <>
        <ClinixBrand />
        {headerAction ?? <div className="flex items-center gap-2">
          <NotificationBell />
          <span className="clear-glass grid size-11 place-items-center rounded-full">
            <AccountMenu />
          </span>
        </div>}
        </>}
      </header>

      <ConnectionStatus className={`relative z-[1] mx-auto w-full ${width}`} />

      {!hideHeading && <div className={`relative z-[1] mx-auto w-full ${width} px-6 pt-2`}>
        <p className="clinix-label text-clear-secondary">{workspace} workspace</p>
        <h1 className="mt-1 text-[2rem] font-bold leading-[1.19] tracking-[-0.02em] text-clear-ink">{title}</h1>
      </div>}

      <main className={`relative z-[1] mx-auto w-full ${width} space-y-6 px-6 pt-6 ${flowNavigation ? "pb-6" : "pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pb-10"}`}>
        {children}
      </main>

      {!hideNavigation && <nav
        aria-label={`${workspace} workspace`}
        className={`clear-glass z-40 !rounded-[28px] p-1.5 ${flowNavigation ? "relative mx-auto mb-6 w-[calc(100%_-_3rem)] max-w-[398px]" : "fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] mx-auto max-w-[398px] md:sticky md:inset-x-auto md:bottom-4"}`}
      >
        <ul className="grid auto-cols-fr grid-flow-col">
          {nav.map((item) => {
            const base = "flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-[22px] px-1 text-center text-[11px] leading-[15px] [overflow-wrap:anywhere]";
            return (
              <li key={item.label} className="min-w-0">
                {item.disabled ? (
                  <span aria-disabled="true" className={`${base} text-clear-secondary/50`}>
                    <UiIcon name={iconFor(item.label)} />
                    <span>{item.label}</span>
                  </span>
                ) : (
                  <Link
                    href={item.href}
                    aria-current={item.active ? "page" : undefined}
                    className={`${base} font-medium transition-colors ${
                      item.active
                        ? "bg-clear-selection text-clear-action"
                        : "text-clear-secondary hover:text-clear-ink"
                    }`}
                  >
                    <UiIcon name={iconFor(item.label)} />
                    <span>{item.label}</span>
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </nav>}
    </div>
  );
}
