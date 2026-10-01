"use client";

import { UserButton } from "@clerk/nextjs";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Shared workspace shell (DESIGN.md §4 navigation): botanical header,
 * profile menu for switching, bottom dock with the active item marked.
 */
export function WorkspaceShell({
  workspace,
  title,
  nav,
  children,
}: {
  workspace: string;
  title: string;
  nav: { label: string; href: string; active?: boolean; disabled?: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between bg-botanical px-6 py-4 text-surface">
        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-sage">
            CliniX · {workspace}
          </p>
          <h1 className="mt-1 font-sans text-2xl font-semibold">{title}</h1>
        </div>
        <UserButton />
      </header>

      <main className="flex-1 space-y-6 px-6 py-8">{children}</main>

      <nav className="sticky bottom-0 border-t border-hairline bg-surface px-6 py-3">
        <ul className="flex justify-between font-sans text-xs text-graphite">
          {nav.map((item) => (
            <li key={item.label}>
              {item.disabled ? (
                <span className="text-hairline" aria-disabled="true">
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href}
                  className={item.active ? "font-semibold text-botanical" : undefined}
                >
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
