import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";

/** Shared 430px composition for authentication, onboarding, and settings. */
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
    <main data-ui="clear" className="min-h-dvh px-6 pb-12 pt-[max(2rem,env(safe-area-inset-top))] sm:py-12">
      <div className="mx-auto w-full max-w-[430px]">
        <header className="flex justify-start">
          <ClinixBrand />
        </header>
        <div className="mt-10">
          <p className="clinix-label text-clear-action">{eyebrow}</p>
          <h1 className="mt-2 text-[2.125rem] font-bold leading-[1.15] tracking-[-0.02em] text-clear-ink">{title}</h1>
          <p className="mt-3 max-w-[65ch] text-[0.9375rem] leading-[1.4] text-clear-secondary">{orientation}</p>
        </div>
        <div className="mt-8">{children}</div>
      </div>
    </main>
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
