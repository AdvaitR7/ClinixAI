"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ClinixBrand } from "@/components/clinix-brand";

/** Provides the source visit header while preserving a real parent or edit action. */
export function PatientVisitHeader({
  onBack,
  backHref = "/app/patient/appointments",
  action,
  busy = false,
}: {
  onBack?: () => void;
  backHref?: string;
  action: ReactNode;
  busy?: boolean;
}) {
  return (
    <div className="flex w-full items-center justify-between gap-2 [&>span>span:last-child]:text-2xl [&>span>span:last-child]:font-normal">
      {onBack ? (
        <button
          type="button"
          aria-label="Back to edit booking"
          onClick={onBack}
          disabled={busy}
          className="grid size-11 shrink-0 place-items-center text-2xl text-botanical disabled:opacity-50"
        >
          ←
        </button>
      ) : (
        <Link
          href={backHref}
          aria-label="Back"
          className="grid size-11 shrink-0 place-items-center text-2xl text-botanical"
        >
          ←
        </Link>
      )}
      <ClinixBrand monogram />
      <div className="min-w-10 text-right text-xs text-evidence">{action}</div>
    </div>
  );
}

export const patientVisitNav = [
  { label: "Home", href: "/app/patient" },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Reports", href: "/app/patient/vault" },
  { label: "Visits", href: "/app/patient/appointments" },
  { label: "Medications", href: "/app/patient/medications" },
  { label: "You", href: "/settings" },
];
