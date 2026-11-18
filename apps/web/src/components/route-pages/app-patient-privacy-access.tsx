"use client";


import { useRouteParam } from "@/lib/route-params";

import Link from "next/link";

import type { AccessReceipt } from "@clinix/schemas";
import { PatientVisitHeader } from "@/components/patient-visit-header";
import { WorkspaceShell } from "@/components/workspace-shell";
import { useApiData } from "@/lib/api";
import { careNav, formatDateTime, privacyCard, privacyLabel } from "@/lib/privacy";

/** Page 13a: access receipt detail for one ledger row. Structured fields only, no record content. */
export default function AccessReceiptPage() {
  const eventId = useRouteParam("eventId");
  const receipt = useApiData<AccessReceipt>(`/patients/self/access-events/${encodeURIComponent(eventId)}`);

  return (
    <WorkspaceShell workspace="Patient" title="Access receipt" nav={careNav("None")} focused hideHeading
      headerContent={<PatientVisitHeader backHref="/app/patient/privacy" action={<span />} />}>
      <div>
        <p className={privacyLabel}>Patient record · access receipt</p>
        <h1 className="mt-4 text-[30px] leading-tight">Access receipt</h1>
      </div>
      {receipt.status === "loading" && <p role="status" className="text-xs text-graphite">Loading receipt…</p>}
      {receipt.status === "error" && (
        <section className={privacyCard}>
          <p role="alert" className="text-sm text-critical">This receipt could not be loaded.</p>
          <div className="mt-3 flex gap-4">
            <button type="button" onClick={() => void receipt.refresh()} className="min-h-11 text-xs font-semibold uppercase text-clear-info">Try again</button>
            <Link href="/app/patient/privacy" className="inline-flex min-h-11 items-center text-xs font-semibold text-botanical">Back to ledger</Link>
          </div>
        </section>
      )}
      {receipt.status === "ready" && <Receipt receipt={receipt.data} />}
    </WorkspaceShell>
  );
}

/** Renders the receipt facts; values come straight from the append-only ledger row. */
function Receipt({ receipt }: { receipt: AccessReceipt }) {
  const rows: [string, string][] = [
    ["Who", `${receipt.actor.display_name} · ${receipt.actor.role_label}`],
    ["Action", receipt.action],
    ["Record", receipt.resource_label],
    ["When", formatDateTime(receipt.timestamp)],
  ];
  if (receipt.purpose) rows.push(["Purpose", receipt.purpose]);
  if (receipt.legal_basis) rows.push(["Basis", receipt.legal_basis]);
  return (
    <article className={privacyCard}>
      <span className="rounded-full border border-sage px-2 py-1 text-xs uppercase">{receipt.category === "AI" ? "AI inference audit" : `${receipt.category.toLowerCase()} access`}</span>
      <dl className="mt-4 space-y-3 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 border-b border-hairline pb-2 last:border-0">
            <dt className="text-graphite">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {receipt.consent && (
        <section className="mt-4 rounded-2xl bg-canvas p-4">
          <h2 className={privacyLabel}>Consent scope</h2>
          <p className="mt-2 text-xs">{receipt.consent.purpose}</p>
          <ul className="mt-2 list-inside list-disc text-xs">
            {receipt.consent.scopes.map((scope) => <li key={scope}>{scope}</li>)}
          </ul>
        </section>
      )}
      <p className="mt-4 text-xs leading-4 text-graphite">This receipt is read-only and part of your append-only ledger. It shows who accessed what, never the record itself.</p>
    </article>
  );
}
