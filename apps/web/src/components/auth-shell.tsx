import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";

/** Shared 393px composition for authentication, onboarding, and settings. */
export function AuthShell({
  eyebrow,
  title,
  orientation,
  children,
  tone = "patient",
}: {
  eyebrow: string;
  title: string;
  orientation: string;
  children: ReactNode;
  tone?: "patient" | "doctor";
}) {
  const doctor = tone === "doctor";
  return (
    <main className={`min-h-dvh px-6 pb-12 pt-8 sm:py-12 ${doctor ? "bg-ink text-surface" : "bg-canvas text-ink"}`}>
      <div className="mx-auto w-full max-w-[34rem]">
        <header className="flex justify-center sm:justify-start">
          <ClinixBrand inverted={doctor} />
        </header>
        <div className="mt-11">
          <p className={`clinix-label ${doctor ? "text-copper" : "text-botanical"}`}>{eyebrow}</p>
          <h1 className={`mt-2 font-sans text-[2rem] font-bold leading-[1.1] tracking-[-0.04em] ${doctor ? "text-surface" : "text-ink"}`}>
            {title}
          </h1>
          <p className={`mt-3 max-w-[65ch] font-sans text-sm leading-6 ${doctor ? "text-doctor-muted/80" : "text-graphite"}`}>
            {orientation}
          </p>
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
