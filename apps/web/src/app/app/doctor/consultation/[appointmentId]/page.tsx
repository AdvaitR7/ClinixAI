"use client";

import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { ConsultationContext, NoteSections } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Desk", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule" },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor", disabled: true },
];

const SECTIONS: { key: keyof NoteSections; label: string }[] = [
  { key: "complaint", label: "Complaint" },
  { key: "observations", label: "Observations" },
  { key: "assessment", label: "Assessment" },
  { key: "plan", label: "Plan" },
];

const PAYMENT_OPTIONS = ["UNPAID", "REQUESTED", "PAID", "WAIVED", "REFUNDED"];

function fmtAt(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Page 18 — Consultation workspace (SCREEN_CATALOG §7, Figma 56:2 & 56:33). */
export default function ConsultationPage() {
  const params = useParams<{ appointmentId: string }>();
  const router = useRouter();
  const { getToken } = useAuth();
  const state = useApiData<ConsultationContext>(
    params.appointmentId ? `/doctor/appointments/${params.appointmentId}/consultation` : null,
  );

  const [sections, setSections] = useState<NoteSections>({});
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [amending, setAmending] = useState(false);
  const [amendReason, setAmendReason] = useState("");
  const [confirmComplete, setConfirmComplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (state.status === "ready" && !initialized.current) {
      initialized.current = true;
      setSections(state.data.note ?? {});
    }
  }, [state.status]);

  // Debounced autosave (800ms) of the structured note.
  useEffect(() => {
    if (!dirty || state.status !== "ready" || state.data.note_is_final) return;
    const t = setTimeout(async () => {
      const token = await getToken();
      if (!token) return;
      await fetchApi(token, `/doctor/encounters/${state.data.encounter_id}/note`, {
        method: "PUT",
        body: JSON.stringify(sections),
      });
      setSavedAt(new Date());
    }, 800);
    return () => clearTimeout(t);
  }, [sections, dirty, state.status, getToken]);

  async function complete() {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/appointments/${params.appointmentId}/complete`, {
        method: "POST",
        body: "{}",
      });
      await state.refresh();
      setConfirmComplete(false);
    } finally {
      setBusy(false);
    }
  }

  async function amend() {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/encounters/${state.status === "ready" ? state.data.encounter_id : ""}/note/amend`, {
        method: "POST",
        body: JSON.stringify({ reason: amendReason, ...sections }),
      });
      setAmending(false);
      setAmendReason("");
      await state.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function setPayment(status: string) {
    const token = await getToken();
    if (!token) return;
    await fetchApi(token, `/doctor/appointments/${params.appointmentId}/payment-status`, {
      method: "POST",
      body: JSON.stringify({ payment_status: status }),
    });
    await state.refresh();
  }

  if (state.status === "loading") {
    return (
      <WorkspaceShell workspace="Doctor" title="Consultation" nav={nav}>
        <div className="space-y-3" aria-hidden="true">
          <Skeleton className="h-28 rounded-2xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      </WorkspaceShell>
    );
  }

  if (state.status === "error") {
    return (
      <WorkspaceShell workspace="Doctor" title="Consultation" nav={nav}>
        <section className="clinix-doctor-card p-5">
          <p className="font-sans text-sm text-critical">{state.error}</p>
        </section>
      </WorkspaceShell>
    );
  }

  const ctx = state.data;
  const readOnly = ctx.note_is_final;

  return (
    <WorkspaceShell workspace="Doctor" title="Consultation workspace" nav={nav}>
      <header className="clinix-doctor-card border-copper p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="clinix-label text-copper">Encounter</p>
            <h2 className="mt-1 font-sans text-xl font-bold text-surface">{ctx.appointment.patient_name}</h2>
            <p className="mt-1 font-mono text-xs text-doctor-muted/70">
              {fmtAt(ctx.appointment.scheduled_start)} · {ctx.appointment.appointment_type}
              {ctx.appointment.reason ? ` · ${ctx.appointment.reason}` : ""}
            </p>
          </div>
          <StatusBadge status={ctx.appointment.status} />
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
          <div className="flex items-center gap-2">
            <span className="font-sans text-xs text-doctor-muted/70">Payment</span>
            <select
              value={ctx.appointment.payment_status}
              onChange={(e) => setPayment(e.target.value)}
              className="h-8 rounded-lg border border-white/10 bg-doctor-panel px-2 font-sans text-xs text-surface outline-none"
            >
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <span className="font-sans text-[11px] text-doctor-muted/60">
            {readOnly ? "Note is finalized (immutable)" : savedAt ? `Saved ${savedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Autosaving"}
          </span>
        </div>
      </header>

      {/* Structured clinical note */}
      <section className="clinix-doctor-card p-5">
        <div className="flex items-center justify-between">
          <p className="clinix-label text-copper">Clinical note</p>
          <span className="font-sans text-[11px] text-doctor-muted/60">
            {readOnly ? "Read-only" : "800ms autosave"}
          </span>
        </div>

        {readOnly ? (
          <dl className="mt-4 space-y-3 font-sans text-sm">
            {SECTIONS.map((s) => (
              <div key={s.key} className="border-t border-white/5 pt-2.5">
                <dt className="font-semibold text-surface">{s.label}</dt>
                <dd className="mt-1 text-doctor-muted/80 whitespace-pre-wrap">
                  {ctx.note?.[s.key] || "—"}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-4 space-y-4">
            {SECTIONS.map((s) => (
              <div key={s.key}>
                <label className="font-sans text-xs font-semibold uppercase tracking-wider text-doctor-muted/75">
                  {s.label}
                </label>
                <textarea
                  value={sections[s.key] ?? ""}
                  onChange={(e) => {
                    setSections((prev) => ({ ...prev, [s.key]: e.target.value }));
                    setDirty(true);
                  }}
                  rows={3}
                  className="mt-1.5 w-full rounded-2xl border border-white/10 bg-doctor-panel px-3.5 py-2.5 font-sans text-sm text-surface outline-none focus:border-copper"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Current medications */}
      <section className="clinix-doctor-card p-5">
        <p className="clinix-label text-copper">Current medications</p>
        {ctx.current_medications.length === 0 ? (
          <p className="mt-2 font-sans text-xs text-doctor-muted/60">None recorded.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {ctx.current_medications.map((m, i) => (
              <li key={i} className="rounded-xl border border-white/5 bg-black/20 p-2.5 font-sans text-xs text-surface">
                <span className="font-semibold">{m.medicine_name}</span>
                <span className="text-doctor-muted/70">
                  {" · "}{[m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || "No details"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Action workbench */}
      <div className="space-y-3">
        <button
          type="button"
          onClick={() =>
            router.push(
              `/app/doctor/prescription-drafts/new?encounterId=${ctx.encounter_id}&patientId=${ctx.appointment.patient_id}`,
            )
          }
          className="min-h-[52px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink transition-transform active:translate-y-px"
        >
          Create prescription
        </button>

        {readOnly ? (
          amending ? (
            <section className="clinix-doctor-card border-copper p-5">
              <p className="clinix-label text-copper">Amend note</p>
              <label className="mt-2 block font-sans text-xs text-doctor-muted/80">Reason for amendment *</label>
              <input
                type="text"
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                placeholder="Clinical reason for this change"
                className="mt-1.5 min-h-[46px] w-full rounded-xl border border-white/10 bg-doctor-panel px-3 font-sans text-sm text-surface outline-none focus:border-copper"
              />
              <div className="mt-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => setAmending(false)}
                  className="min-h-11 flex-1 rounded-xl border border-white/10 bg-doctor-panel font-sans text-xs font-semibold text-surface"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={amend}
                  disabled={busy || !amendReason.trim()}
                  className="min-h-11 flex-1 rounded-xl bg-copper font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
                >
                  Save amendment
                </button>
              </div>
            </section>
          ) : (
            <button
              type="button"
              onClick={() => setAmending(true)}
              className="min-h-[52px] w-full rounded-[1.25rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm font-semibold text-surface"
            >
              Amend note
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => setConfirmComplete(true)}
            className="min-h-[52px] w-full rounded-[1.25rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm font-semibold text-surface"
          >
            Complete consultation
          </button>
        )}
      </div>

      {/* Complete Consultation confirmation modal (Node 56:33) */}
      {confirmComplete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="complete-consult-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4"
        >
          <div className="w-full max-w-sm rounded-[1.75rem] border border-copper bg-doctor-panel p-6 shadow-2xl">
            <span className="rounded-full border border-copper/50 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-copper">
              Final Review
            </span>
            <h3 id="complete-consult-title" className="mt-2 font-sans text-xl font-bold text-surface">
              Complete consultation?
            </h3>
            <p className="mt-2 font-sans text-xs leading-5 text-doctor-muted/75">
              The clinical note will be finalized and locked into an immutable record. Later changes will create dated amendments.
            </p>
            <div className="mt-4 space-y-2 rounded-xl bg-black/30 p-3 font-sans text-xs text-doctor-muted/80">
              <p className="flex items-center gap-2"><span>✓</span> Clinical note recorded</p>
              <p className="flex items-center gap-2"><span>✓</span> Encounter status will become Completed</p>
            </div>
            <div className="mt-6 flex gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmComplete(false)}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl border border-white/10 font-sans text-xs font-semibold text-surface"
              >
                Return to draft
              </button>
              <button
                type="button"
                onClick={complete}
                disabled={busy}
                className="min-h-11 flex-1 rounded-xl bg-copper font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
              >
                {busy ? "Finalizing…" : "Confirm complete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
