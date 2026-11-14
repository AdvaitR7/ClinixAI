"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DetailedTimelineItem, MedicationView, PrescriptionView } from "@clinix/schemas";
import { useApiData } from "@/lib/api";

/** Reads a linked immutable prescription version without substituting a newer amendment. */
export function MedicationPrescription({ medication }: { medication: MedicationView }) {
  const source = useApiData<PrescriptionView>(`/patients/self/prescriptions/${encodeURIComponent(medication.prescription_id!)}`);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const versionNumber = selectedVersion ?? medication.prescription_version_number;
  const record = source.status === "ready" ? source.data : null;
  const version = versionNumber ? record?.versions.find((item) => item.version_number === versionNumber) : record?.current_version;
  return <section className="mt-8 space-y-5">
    <SourceHeading title="Prescription record" />
    {source.status === "loading" && <p role="status" className="text-sm">Loading prescription…</p>}
    {source.status === "error" && <div role="alert" className="text-sm text-critical"><p>{source.error}</p><button type="button" onClick={() => void source.refresh()} className="mt-3 min-h-11 underline">Retry prescription</button></div>}
    {record && <>
      <p className="text-xs">Prescription status: {record.status.toLowerCase()}</p>
      {!medication.prescription_version_number && <p className="text-xs text-review">The original version was not recorded for this exposure. Showing the current prescription version.</p>}
      {record.versions.length > 1 && <div><label htmlFor="prescription-version" className="text-xs">Prescription version</label><select id="prescription-version" value={versionNumber ?? record.current_version.version_number} onChange={(event) => setSelectedVersion(Number(event.target.value))} className="clinix-field mt-2 text-sm">{versionNumber && !record.versions.some((item) => item.version_number === versionNumber) && <option value={versionNumber} disabled>Version {versionNumber} · unavailable</option>}{record.versions.map((item) => <option key={item.version_number} value={item.version_number}>Version {item.version_number}{item.version_number === medication.prescription_version_number ? " · linked original" : ""}</option>)}</select></div>}
      {!version && <p role="alert" className="text-sm text-critical">The linked original version is unavailable. A newer prescription has not been substituted.</p>}
      {version && <>
        <div className="clinix-card p-4 text-xs"><p className="text-[10px] tracking-wider text-botanical">DOCTOR-AUTHORED · VERSION {version.version_number}</p><p className="mt-3">{version.finalized_by || "Author unavailable"}</p><p className="mt-2">{new Date(version.finalized_at).toLocaleString("en-GB")}</p>{version.amendment_reason && <p className="mt-3">Amendment reason: {version.amendment_reason}</p>}</div>
        <ul className="space-y-4">{version.items.map((item, index) => <li key={index} className="clinix-card p-4"><h3 className="break-words text-lg">{[item.medicine_name, item.strength].filter(Boolean).join(" · ")}</h3><dl className="mt-3 space-y-2 text-xs">{[["Dose", item.dose], ["Route", item.route], ["Frequency", item.frequency], ["Timing", item.timing], ["Duration", item.duration], ["Instructions", item.instructions]].map(([label, value]) => <div key={label} className="grid grid-cols-[1fr_1.4fr] gap-3 border-t border-hairline pt-2"><dt className="text-graphite">{label}</dt><dd className="break-words">{value || "Not recorded"}</dd></div>)}</dl></li>)}</ul>
      </>}
      <p className="text-xs leading-5 text-graphite">A prescription records what was prescribed. It does not establish current use or permission to restart treatment.</p>
    </>}
  </section>;
}

/** Shows only the selected owned Timeline encounter; other patients or unrelated entries never substitute. */
export function MedicationEncounter({ encounterId }: { encounterId: string }) {
  const timeline = useApiData<{ entries: DetailedTimelineItem[] }>("/patients/self/timeline");
  const entry = timeline.status === "ready" ? timeline.data.entries.find((item) => item.type === "ENCOUNTER" && item.metadata?.encounter_id === encounterId) : null;
  return <section className="mt-8 space-y-5">
    <SourceHeading title="Encounter chapter" />
    {timeline.status === "loading" && <p role="status" className="text-sm">Loading encounter chapter…</p>}
    {timeline.status === "error" && <div role="alert" className="text-sm text-critical"><p>{timeline.error}</p><button type="button" onClick={() => void timeline.refresh()} className="mt-3 min-h-11 underline">Retry encounter</button></div>}
    {timeline.status === "ready" && !entry && <div role="alert" className="text-sm"><p>This encounter is unavailable in your Timeline.</p><button type="button" onClick={() => void timeline.refresh()} className="mt-3 min-h-11 underline">Retry encounter</button></div>}
    {entry && <article className="clinix-card space-y-4 p-5"><p className="text-[10px] tracking-wider text-botanical">{entry.chapter}</p><h3 className="break-words text-xl">{entry.title}</h3><p className="text-xs text-graphite">{new Date(entry.timestamp).toLocaleString("en-GB")}</p><p className="text-[10px]">{entry.provenance.replaceAll("_", " ")}</p><p className="text-sm leading-6">{entry.summary}</p>{typeof entry.metadata?.status === "string" && <p className="text-xs">Recorded status: {entry.metadata.status}</p>}</article>}
    <Link href="/app/patient/timeline" className="clinix-action flex min-h-12 items-center justify-center rounded-2xl bg-botanical px-4 text-xs text-surface">Open full Timeline</Link>
  </section>;
}

/** Announces a source-panel change and places keyboard focus at its heading. */
function SourceHeading({ title }: { title: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <h2 ref={heading} tabIndex={-1} id="medication-detail-title" className="text-[27px] leading-tight">{title}</h2>;
}
