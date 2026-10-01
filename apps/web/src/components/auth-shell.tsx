import type { ReactNode } from "react";

/**
 * Screen-opening composition for auth/onboarding (DESIGN.md §1):
 * left-aligned eyebrow + title + one-line orientation, no centered hero.
 */
export function AuthShell({
  eyebrow,
  title,
  orientation,
  children,
}: {
  eyebrow: string;
  title: string;
  orientation: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 py-10">
      <p className="font-sans text-xs font-semibold uppercase tracking-wide text-copper">
        {eyebrow}
      </p>
      <h1 className="mt-1 font-sans text-3xl font-semibold tracking-tight">
        {title}
      </h1>
      <p className="mt-2 max-w-[65ch] font-sans text-sm text-graphite">
        {orientation}
      </p>
      <div className="mt-8">{children}</div>
    </div>
  );
}

/** Inline form error (DESIGN.md §4: never toast-only for form errors). */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 font-sans text-sm font-medium text-critical">
      {message}
    </p>
  );
}
