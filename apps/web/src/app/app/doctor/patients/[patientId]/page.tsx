"use client";

import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import type { ClaimInviteView, DoctorWorkspace } from "@clinix/schemas";
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

/** Page 17 — Patient Clinical Workspace (SCREEN_CATALOG §7). */
export default function PatientWorkspacePage() {
  const params = useParams<{ patientId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const state = useApiData<DoctorWorkspace>(
    params.patientId ? `/doctor/patients/${params.patientId}/workspace` : null,
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
        <section className="rounded-2xl border border-hairline bg-surface p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      </WorkspaceShell>
    );
  }

  const d = state.data;
  const age = ageFromDob(d.identity.date_of_birth);

  return (
    <WorkspaceShell workspace="Doctor" title="Patient record" nav={nav}>
      <header className="rounded-2xl bg-botanical p-5 text-surface">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-sans text-lg font-semibold">{d.identity.full_name}</p>
            <p className="mt-1 font-sans text-sm text-sage">
              {[age !== null ? `${age} yr` : null, d.identity.sex_at_registration]
                .filter(Boolean)
                .join(" · ") || "Age not recorded"}
            </p>
            <p className="mt-1 font-mono text-xs text-sage">
              ···· {d.identity.phone_last4}
            </p>
          </div>
          <span className="rounded-full border border-sage/40 px-2 py-0.5 font-sans text-[11px] font-semibold text-sage">
            Consent not configured
          </span>
        </div>
      </header>

      {d.status === "UNCLAIMED" && (
        <section className="rounded-2xl border border-review bg-surface p-5">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-review">
            Unclaimed record
          </p>
          <p className="mt-1 font-sans text-sm text-graphite">
            This record isn&apos;t linked to a patient account yet. Generate a one-time code for
            the patient to claim it.
          </p>
          {invite ? (
            <div className="mt-3 rounded-xl border border-hairline bg-surface p-3">
              <p className="font-sans text-sm">Share this one-time code with the patient:</p>
              <p className="mt-1 font-mono text-lg font-semibold tracking-widest">{invite.invite_token}</p>
              <p className="mt-1 font-sans text-xs text-graphite">
                Expires {new Date(invite.expires_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
            </div>
          ) : (
            <button
              type="button"
              onClick={generateInvite}
              disabled={busy}
              className="mt-3 rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
            >
              Generate claim invite
            </button>
          )}
          {inviteError && (
            <p className="mt-2 font-sans text-sm font-medium text-critical">{inviteError}</p>
          )}
        </section>
      )}

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Current concern
        </p>
        <p className="mt-1 font-sans text-base text-ink">
          {d.current_concern ?? "No concern recorded yet."}
        </p>
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
            Patient record
          </p>
          <span className="font-sans text-[11px] text-graphite">Factual record</span>
        </div>

        <p className="mt-3 font-sans text-sm font-medium">Allergies</p>
        <p className="font-sans text-sm text-graphite">
          {d.allergies.length === 0 ? "None documented" : d.allergies.join(", ")}
        </p>

        <p className="mt-3 font-sans text-sm font-medium">Appointments</p>
        {d.appointments.length === 0 ? (
          <p className="font-sans text-sm text-graphite">No appointments.</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {d.appointments.map((a) => (
              <li key={a.id} className="flex items-center justify-between">
                <span className="font-mono text-xs text-graphite">{fmtAt(a.scheduled_start)}</span>
                <StatusBadge status={a.status} />
              </li>
            ))}
          </ul>
        )}

        {d.timeline.length > 0 && (
          <>
            <p className="mt-3 font-sans text-sm font-medium">Timeline</p>
            <ul className="mt-1 space-y-2">
              {d.timeline.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3">
                  <span className="font-sans text-sm">{t.label}</span>
                  <span className="font-mono text-xs text-graphite">{fmtAt(t.at)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-dashed border-sage bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          AI assistance
        </p>
        <p className="mt-1 font-sans text-sm text-graphite">
          AI relevance and summaries arrive in a later phase. This region is kept separate from
          the patient record.
        </p>
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={startConsultation}
          disabled={
            !d.appointments.some(
              (a) => a.status === "CONFIRMED" || a.status === "REQUESTED",
            )
          }
          className="flex-1 rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite disabled:opacity-60"
        >
          Start consultation
        </button>
        <button
          type="button"
          onClick={createPrescription}
          disabled={busy}
          className="flex-1 rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical disabled:opacity-60"
        >
          Create prescription
        </button>
      </div>
    </WorkspaceShell>
  );
}
