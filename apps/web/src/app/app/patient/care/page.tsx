"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { ConsentView, DoctorOption, RelationshipView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { careNav, expiryText, privacyCard, privacyLabel, scopeSummary } from "@/lib/privacy";
import { WorkspaceShell } from "@/components/workspace-shell";
import { PatientVisitHeader } from "@/components/patient-visit-header";
import { VaultDialog } from "@/components/vault-dialog";

const tabs = ["My Doctors", "Discover verified doctors"] as const;
type Tab = (typeof tabs)[number];

/** Care Circle (SCR-018) and verified-doctor discovery (SCR-019). Adding a doctor never shares records. */
export default function CarePage() {
  const [tab, setTab] = useState<Tab>("My Doctors");
  const circle = useApiData<RelationshipView[]>("/patients/self/doctors");
  const consents = useApiData<ConsentView[]>("/patients/self/consents");
  const myCount = circle.status === "ready" ? circle.data.length : 0;

  return (
    <WorkspaceShell
      workspace="Patient"
      title="Care Circle"
      nav={careNav()}
      focused
      flowNavigation
      hideHeading
      headerContent={<PatientVisitHeader backHref="/app/patient" action={<Link href="/app/patient/privacy" className="inline-flex min-h-9 items-center rounded-full border border-botanical px-3 text-[10px] text-botanical">Privacy</Link>} />}
    >
      <div>
        <p className={privacyLabel}>Patient record · care circle</p>
        <h1 className="mt-4 text-[30px] leading-tight">Care Circle</h1>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface p-1 shadow-sm" role="tablist" aria-label="Care circle sections">
        {tabs.map((item) => (
          <button key={item} id={`care-tab-${item === tabs[0] ? "mine" : "discover"}`} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}
            className={`min-h-11 rounded-xl px-2 text-[11px] ${tab === item ? "bg-botanical text-surface" : "text-graphite"}`}>
            {item === tabs[0] ? `${item} · ${myCount}` : item}
          </button>
        ))}
      </div>
      {tab === "My Doctors" ? (
        <MyDoctors circle={circle} consents={consents} />
      ) : (
        <Discover circle={circle.status === "ready" ? circle.data : []} onAdded={() => { void circle.refresh(); setTab("My Doctors"); }} />
      )}
    </WorkspaceShell>
  );
}

/** Lists the patient's active doctors with their sharing state and the Share / Book / Remove actions. */
function MyDoctors({ circle, consents }: { circle: ReturnType<typeof useApiData<RelationshipView[]>>; consents: ReturnType<typeof useApiData<ConsentView[]>> }) {
  const { getToken } = useAuth();
  const [removing, setRemoving] = useState<RelationshipView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const removeRef = useRef<HTMLButtonElement>(null);

  if (circle.status === "loading") return <p role="status" className="text-sm text-graphite">Loading your care circle…</p>;
  if (circle.status === "error") {
    return <div role="alert" className={privacyCard}><p className="text-sm">{circle.error}</p><button type="button" onClick={() => void circle.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>;
  }
  const active = consents.status === "ready" ? consents.data.filter((c) => c.status === "ACTIVE") : [];

  /** Ends the relationship only; sharing permissions stay until revoked on the privacy screen. */
  async function confirmRemove() {
    if (!removing || busy) return;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, `/patients/self/doctors/${removing.doctor_id}/relationships`, { method: "DELETE" });
      setRemoving(null);
      await circle.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this doctor.");
    } finally {
      setBusy(false);
    }
  }

  if (circle.data.length === 0) {
    return <p className={`${privacyCard} text-sm text-graphite`}>No doctors in your care circle yet. Use Discover verified doctors to add one.</p>;
  }
  return (
    <>
      <section className="space-y-4">
        {circle.data.map((doctor) => {
          const shared = active.filter((c) => c.doctor_id === doctor.doctor_id);
          return (
            <article key={doctor.doctor_id} className={privacyCard}>
              <h2 className="text-lg">Dr. {doctor.doctor_name}</h2>
              <p className="mt-1 text-xs text-graphite">{doctor.speciality ?? "Speciality unavailable"}{doctor.preferred ? " · Preferred" : ""}</p>
              <p className={`${privacyLabel} mt-4`}>Sharing</p>
              {shared.length === 0 ? (
                <p className="mt-1 text-xs">Nothing shared</p>
              ) : shared.map((c) => (
                <p key={c.id} className="mt-1 text-xs">{scopeSummary(c)} · {expiryText(c)}</p>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link href={`/app/patient/care/share/${doctor.doctor_id}`} className="grid min-h-11 place-items-center rounded-full bg-botanical px-3 text-xs text-surface">Share records</Link>
                <Link href={`/app/patient/book?doctorId=${doctor.doctor_id}`} className="grid min-h-11 place-items-center rounded-full border border-sage px-3 text-xs">Book</Link>
                <button type="button" disabled className="min-h-11 rounded-full border border-hairline px-3 text-xs text-graphite/60">Message unavailable</button>
                <button type="button" onClick={(e) => { removeRef.current = e.currentTarget; setError(null); setRemoving(doctor); }} className="min-h-11 rounded-full border border-hairline px-3 text-xs text-critical">Remove</button>
              </div>
            </article>
          );
        })}
      </section>
      {removing && (
        <VaultDialog titleId="care-remove-title" returnFocusRef={removeRef} busy={busy} onClose={() => setRemoving(null)}>
          <h2 id="care-remove-title" className="text-xl">Remove Dr. {removing.doctor_name}?</h2>
          <p className="mt-3 text-sm leading-relaxed">This removes the doctor from your care circle. Active sharing permissions are not changed; revoke them on the privacy screen. Records the doctor already wrote stay with the doctor.</p>
          {error && <p role="alert" className="mt-3 text-sm text-critical">{error}</p>}
          <button type="button" onClick={() => void confirmRemove()} disabled={busy} className="mt-5 min-h-12 w-full rounded-xl bg-critical px-3 text-sm text-surface disabled:opacity-50">{busy ? "REMOVING…" : "Remove from care circle"}</button>
          <button type="button" onClick={() => setRemoving(null)} disabled={busy} className="mt-3 min-h-11 w-full rounded-xl border border-sage text-sm disabled:opacity-50">Keep doctor</button>
        </VaultDialog>
      )}
    </>
  );
}

/** Searches verified doctors; Book and Add never grant record access. */
function Discover({ circle, onAdded }: { circle: RelationshipView[]; onAdded: () => void }) {
  const { getToken } = useAuth();
  const [q, setQ] = useState("");
  const [speciality, setSpeciality] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const doctors = useApiData<DoctorOption[]>(`/doctors?verified_only=true${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ""}`);
  const rows = doctors.status === "ready" ? doctors.data : [];
  const specialities = [...new Set(rows.map((d) => d.speciality).filter((s): s is string => Boolean(s)))];
  const shown = rows.filter((d) => !speciality || d.speciality === speciality);

  /** Adds the doctor to the care circle without creating any consent. */
  async function add(doctorId: string) {
    setAdding(doctorId);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, `/patients/self/doctors/${doctorId}/relationships`, { method: "POST", body: JSON.stringify({ relationship_type: "OTHER", preferred: false }) });
      onAdded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add this doctor.");
    } finally {
      setAdding(null);
    }
  }

  return (
    <>
      <label className="block">
        <span className="sr-only">Search doctors</span>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or speciality" className="clinix-field text-sm" />
      </label>
      {specialities.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by speciality">
          {[null, ...specialities].map((item) => (
            <button key={item ?? "all"} type="button" aria-pressed={speciality === item} onClick={() => setSpeciality(item)} className={`min-h-9 rounded-full border px-3 text-[10px] ${speciality === item ? "border-botanical bg-botanical text-surface" : "border-sage"}`}>{item ?? "All"}</button>
          ))}
        </div>
      )}
      {error && <p role="alert" className="text-xs text-critical">{error}</p>}
      {doctors.status === "loading" && <p role="status" className="text-sm text-graphite">Searching…</p>}
      {doctors.status === "error" && <div role="alert" className={privacyCard}><p className="text-sm">{doctors.error}</p><button type="button" onClick={() => void doctors.refresh()} className="mt-2 min-h-11 text-xs text-evidence">Retry</button></div>}
      {doctors.status === "ready" && shown.length === 0 && <p className={`${privacyCard} text-sm text-graphite`}>No verified doctors match.</p>}
      {shown.map((doctor) => {
        const member = circle.some((r) => r.doctor_id === doctor.doctor_id);
        return (
          <article key={doctor.doctor_id} className={privacyCard}>
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-lg">Dr. {doctor.name}</h2>
              <span className="rounded-full border border-sage px-2 py-1 text-[9px]">VERIFIED</span>
            </div>
            <p className="mt-1 text-xs text-graphite">{doctor.speciality ?? "Speciality unavailable"}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <Link href={`/app/patient/book?doctorId=${doctor.doctor_id}`} className="grid min-h-11 place-items-center rounded-full bg-botanical px-3 text-xs text-surface">Book</Link>
              {member ? (
                <span className="grid min-h-11 place-items-center rounded-full border border-hairline px-3 text-xs text-graphite">In your circle</span>
              ) : (
                <button type="button" disabled={adding === doctor.doctor_id} onClick={() => void add(doctor.doctor_id)} className="min-h-11 rounded-full border border-sage px-3 text-xs disabled:opacity-50">{adding === doctor.doctor_id ? "Adding…" : "Add to Care Circle"}</button>
              )}
            </div>
            <button type="button" disabled className="mt-2 min-h-11 w-full text-right text-[10px] text-graphite/60">View profile unavailable</button>
          </article>
        );
      })}
      <p className="rounded-2xl bg-surface p-4 text-xs leading-relaxed text-graphite">Verification confirms directory credentials. Record access still requires your explicit consent.</p>
    </>
  );
}
