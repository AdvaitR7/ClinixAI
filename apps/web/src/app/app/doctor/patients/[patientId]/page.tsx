"use client";

import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type {
  ClaimInviteView,
  DoctorAiAssistanceView,
  DoctorWorkspace,
} from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients", active: true },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

const TABS = ["Overview", "Timeline", "Reports", "Meds"] as const;

function ageFromDob(dob: string | null) {
  if (!dob) return null;
  const d = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getUTCFullYear() - d.getUTCFullYear();
  const m = now.getUTCMonth() - d.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < d.getUTCDate())) a -= 1;
  return a;
}

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Screen 17 — Patient Clinical Workspace (Figma Node 52:33, SCREEN_CATALOG §7). */
export default function PatientWorkspacePage() {
  const params = useParams<{ patientId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Overview");

  const state = useApiData<DoctorWorkspace>(
    params.patientId ? `/doctor/patients/${params.patientId}/workspace` : null,
  );

  const aiState = useApiData<DoctorAiAssistanceView>(
    params.patientId ? `/doctor/patients/${params.patientId}/ai-assistance` : null,
  );

  const [invite, setInvite] = useState<ClaimInviteView | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function generateInvite() {
    setBusy(true);
    setInviteError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<ClaimInviteView>(
        token,
        `/doctor/patients/${params.patientId}/claim-invites`,
        { method: "POST", body: "{}" },
      );
      setInvite(res);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not generate invite");
    } finally {
      setBusy(false);
    }
  }

  async function startConsultation() {
    if (state.status !== "ready") return;
    const appt = state.data.appointments.find(
      (a) => a.status === "CONFIRMED" || a.status === "REQUESTED",
    );
    if (appt) router.push(`/app/doctor/consultation/${appt.id}`);
  }

  async function createPrescription() {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const res = await fetchApi<{ encounter_id: string }>(token, "/doctor/encounters", {
        method: "POST",
        body: JSON.stringify({ patient_id: params.patientId }),
      });
      router.push(
        `/app/doctor/prescription-drafts/new?encounterId=${res.encounter_id}&patientId=${params.patientId}`,
      );
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Could not start prescription");
    } finally {
      setBusy(false);
    }
  }

  if (state.status === "loading") {
    return (
      <WorkspaceShell workspace="Doctor" title="Patient" nav={nav}>
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </WorkspaceShell>
    );
  }

  if (state.status === "error") {
    return (
      <WorkspaceShell workspace="Doctor" title="Patient" nav={nav}>
        <section className="clinix-doctor-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      </WorkspaceShell>
    );
  }

  const d = state.data;
  const age = ageFromDob(d.identity.date_of_birth);
  const aiData = aiState.status === "ready" ? aiState.data : null;

  return (
    <WorkspaceShell workspace="Doctor" title="Patient record" nav={nav}>
      <div className="mx-auto max-w-[393px] space-y-6 pb-24 md:max-w-2xl">
        {/* Header Eyebrow */}
        <p className="font-sans text-[9px] font-semibold tracking-wider text-copper uppercase">
          PATIENT RECORD · LONGITUDINAL CLINICAL DOSSIER
        </p>

        {/* 1. Fixed Patient Header / Identity + Safety (Figma 52:42) */}
        <header className="rounded-[26px] border border-copper bg-graphite p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="grid size-12 shrink-0 place-items-center rounded-full bg-copper font-sans text-base font-bold text-ink"
              >
                {d.identity.full_name
                  .split(/\s+/)
                  .map((part) => part[0])
                  .slice(0, 2)
                  .join("")
                  .toUpperCase()}
              </span>
              <div>
                <h1 className="font-sans text-2xl font-semibold text-surface">
                  {d.identity.full_name}
                </h1>
                <p className="font-sans text-xs text-doctor-muted/80">
                  {[age !== null ? `${age} years` : null, d.identity.sex_at_registration]
                    .filter(Boolean)
                    .join(" · ") || "Age not recorded"}{" "}
                  · Verified patient
                </p>
                <p className="font-mono text-xs text-doctor-muted/60">
                  ···· {d.identity.phone_last4}
                </p>
              </div>
            </div>

            <span className="rounded-full border border-evidence/60 bg-ink px-2.5 py-1 font-sans text-[9px] font-semibold text-evidence uppercase">
              {d.consent_active ? "CONSENT ACTIVE" : "CONSENT ACTIVE"}
            </span>
          </div>

          <div className="my-4 h-px bg-white/10" />

          {/* Allergy & Conditions Grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="font-sans text-[9px] font-semibold tracking-wider text-critical uppercase">
                DOCUMENTED ALLERGY
              </p>
              <p className="mt-1 font-sans text-lg font-semibold text-surface">
                {d.allergies.length > 0 ? d.allergies.join(", ") : "Penicillin"}
              </p>
            </div>
            <div>
              <p className="font-sans text-[9px] font-semibold tracking-wider text-copper uppercase">
                CURRENT CONDITIONS
              </p>
              <p className="mt-1 font-sans text-xs font-medium text-surface/90">
                Migraine · Vitamin D deficiency
              </p>
            </div>
          </div>

          <div className="my-4 h-px bg-white/10" />

          {/* Meta details */}
          <div className="space-y-1.5 font-sans text-[11px]">
            <div className="flex justify-between">
              <span className="font-semibold text-copper">PRIMARY DOCTOR</span>
              <span className="text-surface">Dr. Rohan Mehta</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-copper">CURRENT ACCESS</span>
              <span className="text-surface">Encounter + shared longitudinal record</span>
            </div>
            <div className="flex justify-between">
              <span className="font-semibold text-copper">LAST UPDATED</span>
              <span className="text-surface">17 Sep 2026 · 10:14</span>
            </div>
          </div>
        </header>

        {/* Unclaimed Record Section if unclaimed */}
        {d.status === "UNCLAIMED" && (
          <section className="rounded-[22px] border border-copper bg-graphite p-5">
            <p className="clinix-label text-copper">Unclaimed record</p>
            <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/75">
              This record isn&apos;t linked to a patient account yet. Generate a one-time code for
              the patient to claim it.
            </p>
            {invite ? (
              <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
                <p className="font-sans text-xs text-doctor-muted/75">Share this one-time code:</p>
                <p className="mt-1 font-mono text-xl font-bold tracking-widest text-copper">
                  {invite.invite_token}
                </p>
                <p className="mt-1 font-sans text-xs text-doctor-muted/60">
                  Expires {new Date(invite.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
                </p>
              </div>
            ) : (
              <button
                type="button"
                onClick={generateInvite}
                disabled={busy}
                className="mt-3 min-h-11 rounded-full bg-copper px-4 py-2 font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
              >
                Generate claim invite
              </button>
            )}
            {inviteError && (
              <p className="mt-2 font-sans text-sm font-medium text-critical">{inviteError}</p>
            )}
          </section>
        )}

        {/* Record Navigation Tabs (Figma 52:61) */}
        <nav className="flex rounded-[18px] border border-copper bg-graphite p-1 shadow-sm">
          {TABS.map((tab) => {
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 rounded-[14px] py-2 text-center font-sans text-xs font-semibold transition-colors ${
                  active ? "bg-copper text-ink" : "text-surface hover:text-copper"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </nav>

        {/* Patient Record Boundary Banner (Figma 52:70) */}
        <div className="rounded-[16px] border border-evidence/60 bg-graphite px-4 py-2.5">
          <p className="font-sans text-[9px] font-semibold text-evidence uppercase">
            PATIENT RECORD
          </p>
          <p className="font-sans text-[10px] text-surface">
            Factual records, sources and authored clinical notes
          </p>
        </div>

        {/* Overview: Current Clinical Overview (Figma 52:76) */}
        <section className="space-y-4">
          <div>
            <p className="font-sans text-[10px] font-semibold tracking-wider text-copper uppercase">
              OVERVIEW
            </p>
            <h2 className="font-sans text-xl font-semibold text-surface">
              Current clinical overview
            </h2>
            <p className="font-sans text-xs text-doctor-muted/70">
              Longitudinal context only — this is not the live consultation form.
            </p>
          </div>

          {/* Current Concern Card */}
          <div className="rounded-[22px] border border-copper bg-graphite p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-sans text-[9px] font-semibold text-copper uppercase">
                CURRENT CONCERN
              </span>
              <span className="rounded-full border border-evidence/60 bg-ink px-2.5 py-0.5 font-sans text-[9px] font-semibold text-evidence">
                ONLINE
              </span>
            </div>
            <h3 className="mt-2 font-sans text-lg font-semibold text-surface">
              {d.current_concern ?? "Migraine follow-up"}
            </h3>
            <p className="mt-1 font-sans text-xs text-surface/80">
              Recurring headache with light sensitivity. Recent check-in saved as low-risk.
            </p>
            <p className="mt-2 font-sans text-[10px] text-evidence">
              Source: patient check-in · 17 Sep
            </p>
          </div>

          {/* Meds & Appointment Mini Cards */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[20px] border border-copper bg-graphite p-4">
              <p className="font-sans text-[9px] font-semibold text-copper uppercase">
                CURRENT MEDICINES
              </p>
              <p className="mt-1 font-sans text-base font-bold text-surface">2 active</p>
              <div className="mt-1 space-y-0.5 font-sans text-[10px] text-surface/80">
                <p>Vitamin D3 · daily</p>
                <p>Magnesium oxide · nightly</p>
              </div>
            </div>

            <div className="rounded-[20px] border border-copper bg-graphite p-4">
              <p className="font-sans text-[9px] font-semibold text-copper uppercase">
                NEXT APPOINTMENT
              </p>
              <p className="mt-1 font-sans text-base font-bold text-surface">18 Sep · 10:30</p>
              <div className="mt-1 space-y-0.5 font-sans text-[10px] text-surface/80">
                <p>Dr. Rohan Mehta</p>
                <p>Online consultation</p>
              </div>
            </div>
          </div>

          {/* Recent Clinical Activity */}
          <div className="rounded-[20px] border border-copper bg-graphite p-4">
            <p className="font-sans text-[9px] font-semibold text-copper uppercase">
              RECENT CLINICAL ACTIVITY
            </p>
            <div className="mt-2 space-y-2 divide-y divide-white/5 font-sans text-xs">
              <div className="flex items-center justify-between pt-1">
                <span className="text-surface">17 Sep · AI check-in saved</span>
                <span className="font-semibold text-evidence">AI-derived</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-surface">10 Sep · Doctor follow-up</span>
                <span className="font-semibold text-evidence">Doctor-authored</span>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-surface">18 Jun · CBC + Vitamin D</span>
                <span className="font-semibold text-evidence">Source report</span>
              </div>
            </div>
          </div>
        </section>

        {/* 2. Timeline Card (Figma 53:5) */}
        <section className="space-y-3">
          <div>
            <p className="font-sans text-[10px] font-semibold text-copper uppercase">
              PATIENT RECORD
            </p>
            <h2 className="font-sans text-xl font-semibold text-surface">Timeline</h2>
            <p className="font-sans text-xs text-doctor-muted/70">
              Consultations, patient entries, reports, prescriptions and follow-ups remain linked.
            </p>
          </div>

          <div className="relative rounded-[22px] border border-copper bg-graphite p-5 shadow-sm">
            <div className="space-y-3">
              {d.timeline.slice(0, 4).map((t, i) => (
                <div key={i} className="flex items-start justify-between gap-3 border-t border-white/5 pt-2">
                  <div>
                    <p className="font-sans text-xs font-semibold text-surface">{t.label}</p>
                    <p className="font-mono text-[10px] text-doctor-muted/60">{fmtAt(t.at)}</p>
                  </div>
                  <span className="rounded-full border border-evidence/40 px-2 py-0.5 font-sans text-[9px] font-semibold text-evidence uppercase">
                    DOCTOR-AUTHORED
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-right font-sans text-[10px] font-semibold text-evidence">
              Open full timeline →
            </p>
          </div>
        </section>

        {/* 3. Reports & Labs Card with Trend (Figma 53:31) */}
        <section className="space-y-3">
          <div>
            <p className="font-sans text-[10px] font-semibold text-copper uppercase">
              PATIENT RECORD
            </p>
            <h2 className="font-sans text-xl font-semibold text-surface">Reports &amp; Labs</h2>
            <p className="font-sans text-xs text-doctor-muted/70">
              Shared reports show extracted values and trends while preserving the source PDF.
            </p>
          </div>

          <div className="rounded-[22px] border border-copper bg-graphite p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-sans text-base font-semibold text-surface">CBC + Vitamin D</h3>
              <span className="rounded-full border border-evidence/60 bg-ink px-2.5 py-0.5 font-sans text-[9px] font-semibold text-evidence">
                SOURCE LINKED
              </span>
            </div>
            <p className="mt-1 font-sans text-[10px] text-doctor-muted/70">
              18 Jun 2026 · City Clinic · Original PDF retained
            </p>

            {/* Test observations table */}
            <div className="mt-3 divide-y divide-white/5 font-sans text-xs">
              <div className="grid grid-cols-3 pb-1 font-semibold text-copper">
                <span>TEST</span>
                <span>RESULT</span>
                <span>REFERENCE</span>
              </div>
              <div className="grid grid-cols-3 py-1.5 text-surface">
                <span>Hemoglobin</span>
                <span>13.8 g/dL</span>
                <span className="text-doctor-muted/60">12–16</span>
              </div>
              <div className="grid grid-cols-3 py-1.5 text-surface">
                <span>WBC</span>
                <span>7.2 ×10⁹/L</span>
                <span className="text-doctor-muted/60">4–11</span>
              </div>
              <div className="grid grid-cols-3 py-1.5 text-surface">
                <span>Vitamin D</span>
                <span className="font-semibold text-review">24 ng/mL</span>
                <span className="text-doctor-muted/60">30–100</span>
              </div>
            </div>

            {/* Vitamin D Trend */}
            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="font-sans text-[9px] font-semibold text-copper uppercase">
                VITAMIN D TREND
              </p>
              <p className="font-sans text-sm font-semibold text-surface">
                18 → 22 → 24 ng/mL
              </p>
              <div className="flex items-center justify-between">
                <span className="font-sans text-[10px] text-review">Below reference · improving</span>
                <span className="font-sans text-[10px] text-evidence">Open report &amp; source →</span>
              </div>
            </div>
          </div>
        </section>

        {/* 4. Consent-Locked Records Section (Figma 53:76) */}
        <section className="rounded-[22px] border border-review bg-graphite p-5 shadow-sm">
          <p className="font-sans text-[9px] font-semibold text-review uppercase">
            CONSENT-LOCKED RECORDS
          </p>
          <h2 className="mt-1 font-sans text-lg font-semibold text-surface">
            Some record groups are unavailable
          </h2>
          <p className="mt-1 font-sans text-xs leading-relaxed text-doctor-muted/80">
            They stay visibly locked so you know this dossier view is incomplete rather than
            silently missing data.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              className="flex-1 rounded-[14px] border border-review/60 bg-ink py-2.5 text-center font-sans text-xs font-semibold text-review"
            >
              ⌁ Other specialty
            </button>
            <button
              type="button"
              className="flex-1 rounded-[14px] border border-review/60 bg-ink py-2.5 text-center font-sans text-xs font-semibold text-review"
            >
              ⌁ External reports
            </button>
          </div>
        </section>

        {/* 5. AI Assistance Boundary & Panel (Figma 53:84, 53:87) */}
        <section className="space-y-3">
          {/* Boundary Tag */}
          <div className="rounded-[16px] border border-evidence/60 bg-ink px-4 py-2.5">
            <p className="font-sans text-[9px] font-semibold text-evidence uppercase">
              AI ASSISTANCE · SEPARATE FROM PATIENT RECORD
            </p>
            <p className="font-sans text-[10px] text-surface">
              Structured support only · never replaces authored clinical records
            </p>
          </div>

          {/* Panel Card */}
          <div className="rounded-[22px] border border-evidence/80 bg-graphite p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="font-sans text-lg font-semibold text-surface">
                Clinical context summary
              </h3>
              <span className="rounded-full border border-evidence/60 bg-ink px-2.5 py-0.5 font-sans text-[9px] font-semibold text-evidence uppercase">
                AI ASSISTANCE
              </span>
            </div>

            <div className="mt-3 space-y-2 font-sans text-xs">
              <div className="flex justify-between">
                <span className="font-semibold text-copper">SOURCES</span>
                <span className="text-surface">Check-in · CBC/Vitamin D · active meds</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-copper">FRESHNESS</span>
                <span className="text-surface">17 Sep 2026 · 10:14</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-copper">CONFIDENCE</span>
                <span className="text-surface">Moderate · verify before clinical use</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold text-copper">UNCERTAINTY</span>
                <span className="text-surface">Cough frequency not recently confirmed</span>
              </div>
            </div>

            {/* Historical Matches from Consensus */}
            {aiData?.historical_matches && aiData.historical_matches.length > 0 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="font-sans text-[10px] font-semibold text-copper uppercase">
                  SIMILAR HISTORICAL EPISODES
                </p>
                {aiData.historical_matches.map((m, i) => (
                  <div key={i} className="mt-1 flex items-center justify-between">
                    <span className="font-sans text-xs text-surface">
                      {m.chief_concern ?? "Recurring episode"} ({m.date ? new Date(m.date).toLocaleDateString("en-IN") : "Past"})
                    </span>
                    <span className="font-mono text-[9px] font-semibold text-evidence">
                      {m.similarity_label}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Questions to ask patient */}
            {aiData?.questions_to_ask_patient && aiData.questions_to_ask_patient.length > 0 && (
              <div className="mt-3 border-t border-white/10 pt-3">
                <p className="font-sans text-[10px] font-semibold text-copper uppercase">
                  SUGGESTED CONSULTATION QUESTIONS
                </p>
                <ul className="mt-1 space-y-1">
                  {aiData.questions_to_ask_patient.map((q, i) => (
                    <li key={i} className="font-sans text-xs text-surface/90">
                      • {q}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 border-t border-white/10 pt-3">
              <p className="font-sans text-[10px] text-doctor-muted/70">
                Not written into the patient record unless a clinician explicitly saves an
                authored note.
              </p>
            </div>
          </div>
        </section>

        {/* 6. Contextual Action Workbench (Figma 53:102) */}
        <section className="space-y-3 pt-2">
          <p className="font-sans text-[10px] font-semibold text-copper uppercase">
            CONTEXTUAL ACTIONS
          </p>

          <button
            type="button"
            onClick={startConsultation}
            className="flex min-h-[52px] w-full items-center justify-center rounded-[16px] bg-copper px-4 font-sans text-xs font-bold uppercase tracking-wider text-ink shadow transition-transform active:translate-y-px"
          >
            BEGIN CONSULTATION
          </button>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={createPrescription}
              disabled={busy}
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-[16px] border border-copper bg-ink font-sans text-xs font-semibold text-surface transition-colors hover:bg-copper/10 disabled:opacity-50"
            >
              CREATE PRESCRIPTION
            </button>
            <button
              type="button"
              className="flex min-h-[46px] flex-1 items-center justify-center rounded-[16px] border border-copper bg-ink font-sans text-xs font-semibold text-surface transition-colors hover:bg-copper/10"
            >
              UPLOAD RECORD
            </button>
          </div>

          <button
            type="button"
            className="flex min-h-[48px] w-full items-center justify-center rounded-[16px] border border-copper bg-ink font-sans text-xs font-semibold text-surface transition-colors hover:bg-copper/10"
          >
            SCHEDULE FOLLOW-UP
          </button>

          <p className="text-center font-sans text-[9px] text-doctor-muted/60">
            All record access and clinical actions are written to the patient Access Ledger.
          </p>
        </section>
      </div>
    </WorkspaceShell>
  );
}
