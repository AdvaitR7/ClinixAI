"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { MedicationView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { useApiData } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ClinixBrand } from "@/components/clinix-brand";
import { patientVisitNav } from "@/components/patient-visit-header";
import { Skeleton } from "@/components/skeleton";
import { VaultDialog } from "@/components/vault-dialog";
import { MedicationEncounter, MedicationPrescription } from "@/components/medication-sources";

const nav = patientVisitNav.map((item) => ({ ...item, active: item.label === "Medications" }));
const filters = [{ key: null, label: "All" }, { key: "CURRENT", label: "Active" }, { key: "PAST", label: "Completed" }, { key: "DISCONTINUED", label: "Discontinued" }, { key: "UNKNOWN_STATUS", label: "Status unknown" }] as const;
const groups = [{ label: "ACTIVE MEDICATIONS", statuses: ["CURRENT"] }, { label: "PAST PRESCRIPTIONS", statuses: ["PAST", "DISCONTINUED"] }, { label: "CURRENT USE UNKNOWN", statuses: ["UNKNOWN_STATUS"] }];

/** Formats only an actual recorded date; exposure creation is not a prescription date. */
function dateLabel(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "Prescription date not recorded";
}

/** Keeps legacy records without source metadata from being mislabelled as confirmed exposures. */
function sourceLabel(item: MedicationView) {
  return item.source_kind === "PRESCRIPTION" ? "PRESCRIPTION" : item.source_kind === "RECORDED_EXPOSURE" ? "EXPOSURE RECORD" : "MEDICATION RECORD";
}

/** Labels recorded exposure status while keeping prescribed use explicitly unknown. */
function MedicationStatus({ status }: { status: MedicationView["status"] }) {
  const label = status === "CURRENT" ? "ACTIVE" : status === "PAST" ? "COMPLETED" : status === "DISCONTINUED" ? "DISCONTINUED" : "STATUS UNKNOWN";
  return <span className={`inline-block shrink-0 rounded-full border px-3 py-1 text-xs ${status === "CURRENT" ? "border-botanical bg-botanical text-surface" : status === "DISCONTINUED" ? "border-clear-divider text-review" : "border-hairline text-graphite"}`}>{label}</span>;
}

/** Uses the source brand/back/close positions without changing another module's header contract. */
function MedicationHeader({ onBack, onClose }: { onBack?: () => void; onClose?: () => void }) {
  return <div className={`flex w-full items-center gap-3 [&>span>span:last-child]:text-2xl [&>span>span:last-child]:font-normal ${onClose ? "justify-between" : ""}`}>
    {onBack ? <button type="button" onClick={onBack} aria-label="Back to medication record" className="grid size-11 shrink-0 place-items-center text-[29px] text-botanical">←</button> : <Link href="/app/patient/vault" aria-label="Back to reports" className="grid size-11 shrink-0 place-items-center text-[29px] text-botanical">←</Link>}
    <ClinixBrand />
    {onClose && <button type="button" onClick={onClose} className="min-h-11 text-xs text-clear-info">Close</button>}
  </div>;
}

/** Keeps medication selection and source content inside the current patient's session. */
export default function MedicationsPage() {
  const { identityVersion } = useAuth();
  return <MedicationRegistry key={identityVersion} />;
}

/** Displays source-aligned medication groups and connected read-only record/source states. */
function MedicationRegistry() {
  const state = useApiData<{ medications: MedicationView[] }>("/patients/self/medications");
  const [filter, setFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<MedicationView | null>(null);
  const [source, setSource] = useState<"prescription" | "encounter" | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const list = state.status === "ready" ? state.data.medications : [];
  const visible = list.filter((item) => !filter || item.status === filter);
  /** Opens the exact registry entry and retains the invoking button for focus return. */
  function open(item: MedicationView, button: HTMLButtonElement) { returnFocus.current = button; setSelected(item); setSource(null); }
  /** Returns from a source to detail, or from detail to the unchanged registry/filter. */
  function back() { if (source) setSource(null); else setSelected(null); }
  /** Closes all local record states without altering the source records or registry filter. */
  function close() { setSelected(null); setSource(null); }
  return <div className="[&>div]:bg-clear-canvas [&>div>header]:bg-clear-canvas"><WorkspaceShell workspace="Patient" title="Medication history" nav={nav} focused flowNavigation hideHeading headerContent={<MedicationHeader />}>
    <div><p className="text-xs tracking-wider text-graphite">PATIENT RECORD · MEDICATION REGISTRY</p><h1 className="mt-3 text-[34px] leading-tight">Medication history</h1><p className="mt-3 text-sm leading-[22px] text-graphite">Encounter-linked prescriptions with source, prescriber, reason, and reaction history preserved.</p></div>
    <div aria-hidden="true" className="h-28 rounded-[28px] bg-clear-divider" />
    {state.status === "loading" && <Skeleton className="h-36 rounded-3xl" />}
    {state.status === "error" && <div role="alert" className="clinix-card p-5 text-sm text-critical"><p>{state.error}</p><button type="button" onClick={() => void state.refresh()} className="mt-3 min-h-11 underline">Retry medications</button></div>}
    {state.status === "ready" && <>
      <section className="clinix-card p-[18px]" aria-label="Medication record summary"><div className="flex items-center justify-between gap-3"><p className="text-xs tracking-wider text-botanical">MEDICATION RECORD</p><span className="rounded-full bg-botanical px-3 py-1.5 text-xs text-surface">{list.filter((item) => item.status === "CURRENT").length} ACTIVE</span></div><p className="mt-4 text-[22px]">{list.length} medication records</p><p className="mt-3 text-xs leading-[18px] text-graphite">Prescription source is doctor-authored. Reaction notes keep their own provenance.</p></section>
      <div><p className="mb-2 text-xs tracking-wider text-graphite">FILTER</p><div aria-label="Filter medications by status" className="flex flex-wrap gap-2">{filters.map((item) => <button key={item.label} type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} className={`min-h-11 rounded-full border px-3 text-xs ${filter === item.key ? "border-botanical bg-botanical text-surface" : "border-hairline bg-surface text-graphite"}`}>{item.label}</button>)}</div></div>
      {!visible.length && <p className="clinix-card p-5 text-sm">{list.length ? "No medications match this filter." : "No medications recorded."}</p>}
      {groups.map((group) => {
        const entries = visible.filter((item) => group.statuses.includes(item.status));
        return entries.length ? <section key={group.label} aria-label={group.label}><h2 className="mb-4 text-xs tracking-wider text-graphite">{group.label}</h2><ul className="space-y-4">{entries.map((item, index) => <li key={item.entry_id ?? `${item.prescription_id}-${item.medicine_name}-${index}`} className="clinix-card p-[18px]">
          <div className="flex items-start justify-between gap-2"><p className="text-xs tracking-wider text-graphite">{sourceLabel(item)}</p><MedicationStatus status={item.status} /></div>
          <h3 className="mt-2 break-words text-[22px] leading-[27px]">{[item.medicine_name, item.strength].filter(Boolean).join(" · ")}</h3>
          <p className="mt-5 text-xs leading-5 text-graphite">{dateLabel(item.prescribed_date)}</p>
          <dl className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 border-t border-hairline pt-4">{[["Dose", item.dose], ["Frequency", item.frequency], ["Route", item.route], ["Duration", item.duration], ["Prescribing doctor", item.prescribing_doctor], ["Reason", item.reason_for_use]].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-graphite">{label}</dt><dd className="mt-1 break-words text-[13px] leading-[18px]">{value || "Not recorded"}</dd></div>)}</dl>
          <div className="mt-4 flex items-center justify-between gap-3"><p className={`min-w-0 break-words text-xs ${item.adverse_reaction ? "text-review" : "text-graphite"}`}>{item.adverse_reaction ? `Recorded reaction · ${item.adverse_reaction}` : "Reaction history not recorded"}</p><button type="button" onClick={(event) => open(item, event.currentTarget)} aria-label={`Open record for ${item.medicine_name}`} className="min-h-11 shrink-0 text-xs text-clear-info">Open record →</button></div>
        </li>)}</ul></section> : null;
      })}
      <p className="clinix-card rounded-2xl p-4 text-xs leading-5 text-graphite">Historical use is not authorization to restart treatment. Source records preserve what was prescribed; current use is shown only when explicitly recorded.</p>
    </>}
    {selected && <VaultDialog fullScreen titleId="medication-detail-title" returnFocusRef={returnFocus} onClose={close}>
      <MedicationHeader onBack={back} onClose={close} />
      {source === "prescription" && selected.prescription_id ? <MedicationPrescription key={selected.prescription_id} medication={selected} /> : source === "encounter" && selected.encounter_id ? <MedicationEncounter key={selected.encounter_id} encounterId={selected.encounter_id} /> : <>
        <p className="mt-6 w-fit rounded-full border border-sage bg-surface px-5 py-2 text-xs text-botanical">{sourceLabel(selected)}</p>
        <p className="mt-5 text-xs uppercase text-graphite">{dateLabel(selected.prescribed_date)}</p>
        <h2 id="medication-detail-title" className="mt-4 break-words text-[27px] leading-tight">{[selected.medicine_name, selected.strength].filter(Boolean).join(" · ")}</h2>
        <div className="mt-3 flex items-center justify-between gap-2"><MedicationStatus status={selected.status} /><span className="rounded-full border border-hairline bg-surface px-4 py-1 text-xs text-graphite">{selected.source_kind === "PRESCRIPTION" ? "DOCTOR-AUTHORED" : selected.source_kind === "RECORDED_EXPOSURE" ? "RECORDED EXPOSURE" : "SOURCE UNKNOWN"}</span></div>
        <section className="clinix-card mt-7 p-4"><h3 className="text-xs tracking-wider text-graphite">MEDICATION DETAILS</h3><dl className="mt-3">{[["Dose", selected.dose], ["Frequency", selected.frequency], ["Route", selected.route], ["Duration", selected.duration], ["Prescribing doctor", selected.prescribing_doctor], ["Associated problem", selected.reason_for_use], ...(selected.timing ? [["Timing", selected.timing]] : []), ...(selected.instructions ? [["Instructions", selected.instructions]] : []), ...(selected.started_on ? [["Recorded start", dateLabel(selected.started_on)]] : []), ...(selected.ended_on ? [["Recorded end", dateLabel(selected.ended_on)]] : [])].map(([label, value]) => <div key={label} className="grid grid-cols-[1fr_1.6fr] gap-3 border-b border-hairline py-2.5 text-xs last:border-0"><dt className="text-graphite">{label}</dt><dd className="break-words">{value || "Not recorded"}</dd></div>)}</dl></section>
        <section className="clinix-card mt-8 p-4"><h3 className="text-xs tracking-wider text-graphite">ADVERSE REACTION NOTES</h3><p className="mt-3 break-words text-sm">{selected.adverse_reaction || "Reaction history not recorded"}</p>{selected.response && <p className="mt-3 text-xs">Recorded response: {selected.response}</p>}{selected.reason_stopped && <p className="mt-3 text-xs">Reason stopped: {selected.reason_stopped}</p>}<p className="mt-3 text-right text-xs text-graphite">{selected.adverse_reaction || selected.response || selected.reason_stopped ? "Attribution not recorded" : "No reaction assertion available"}</p></section>
        <section className="clinix-card mt-6 p-4"><h3 className="text-xs tracking-wider text-graphite">PROVENANCE</h3><p className="mt-3 text-xs leading-[18px]">{selected.source_kind === "PRESCRIPTION" ? `Prescription authored by ${selected.prescribing_doctor || "an unrecorded author"}${selected.prescription_version_number ? ` · version ${selected.prescription_version_number}` : ""}. Current use has not been established.` : `${selected.source_kind === "RECORDED_EXPOSURE" ? "Recorded medication exposure" : "Medication record"}${selected.recorded_at ? ` · recorded ${dateLabel(selected.recorded_at)}` : ""}. Exposure authorship is not available in the current record.`}</p></section>
        <section className="mt-8"><h3 className="text-[21px]">Source records</h3><p className="mt-2 text-xs leading-[17px] text-graphite">Open the exact prescription or the encounter chapter that created this medication record.</p><div className="mt-3 space-y-3">
          <button type="button" onClick={() => setSource("prescription")} disabled={!selected.prescription_id} className="clinix-card flex min-h-20 w-full items-center justify-between gap-3 px-5 py-3 text-left disabled:opacity-50"><span><span className="block text-[13px]">Original prescription</span><span className="mt-2 block text-xs text-graphite">{selected.prescription_id ? selected.prescription_version_number ? `Doctor-authored · version ${selected.prescription_version_number}` : "Linked prescription · original version unknown" : "No prescription source recorded"}</span></span><span aria-hidden="true" className="text-2xl">›</span></button>
          <button type="button" onClick={() => setSource("encounter")} disabled={!selected.encounter_id} className="clinix-card flex min-h-20 w-full items-center justify-between gap-3 px-5 py-3 text-left disabled:opacity-50"><span><span className="block text-[13px]">Encounter chapter</span><span className="mt-2 block text-xs text-graphite">{selected.encounter_id ? "Selected encounter · Timeline" : "No encounter source recorded"}</span></span><span aria-hidden="true" className="text-2xl">›</span></button>
        </div></section>
        <button type="button" disabled={!selected.prescription_id} onClick={() => setSource("prescription")} className="mb-8 mt-6 flex min-h-14 w-full items-center justify-between gap-3 rounded-[20px] bg-botanical px-5 text-xs text-surface disabled:opacity-50">OPEN ORIGINAL PRESCRIPTION <span aria-hidden="true" className="text-2xl">→</span></button>
      </>}
    </VaultDialog>}
  </WorkspaceShell></div>;
}
