"use client";

import { useAuth } from "@/lib/auth";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConsultationContext, NoteSections } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
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

/** Formats consultation and amendment timestamps in the practice timezone. */
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const completeButton = useRef<HTMLButtonElement>(null);
  const latestSections = useRef<NoteSections>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const encounterId = state.status === "ready" ? state.data.encounter_id : null;
  const noteIsFinal = state.status === "ready" && state.data.note_is_final;
  const loadedNote = state.status === "ready" ? state.data.note : undefined;

  useEffect(() => {
    if (loadedNote !== undefined && !initialized.current) {
      initialized.current = true;
      setSections(loadedNote ?? {});
      latestSections.current = loadedNote ?? {};
    }
  }, [loadedNote]);

  /** Serializes writes so a slower earlier autosave cannot overwrite the latest note. */
  const saveNote = useCallback((snapshot: NoteSections) => {
    const pending = saveQueue.current.catch(() => {}).then(async () => {
      if (!encounterId) throw new Error("Consultation is not ready");
      setSaving(true);
      try {
        const token = await getToken();
        if (!token) throw new Error("Not signed in");
        await fetchApi(token, `/doctor/encounters/${encounterId}/note`, {
          method: "PUT",
          body: JSON.stringify(snapshot),
        });
        setSavedAt(new Date());
        setError(null);
        if (latestSections.current === snapshot) setDirty(false);
      } finally {
        setSaving(false);
      }
    });
    saveQueue.current = pending;
    return pending;
  }, [encounterId, getToken]);

  // Debounced autosave is suspended while the clinician reviews or completes the note.
  useEffect(() => {
    if (!dirty || !encounterId || noteIsFinal || busy || confirmComplete) return;
    const t = setTimeout(() => {
      void saveNote(sections).catch((cause) => {
        setError(cause instanceof Error ? cause.message : "Could not save note");
      });
    }, 800);
    return () => clearTimeout(t);
  }, [sections, dirty, encounterId, noteIsFinal, busy, confirmComplete, saveNote]);

  /** Flushes the last visible edits before asking the API to lock the same note. */
  async function complete() {
    setBusy(true);
    setError(null);
    try {
      await saveNote(sections);
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      await fetchApi(token, `/doctor/appointments/${params.appointmentId}/complete`, {
        method: "POST",
        body: JSON.stringify({ reviewed_note: sections }),
      });
      await state.refresh();
      setConfirmComplete(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete consultation");
    } finally {
      setBusy(false);
    }
  }

  /** Appends revised sections and a reason while preserving the original finalized note. */
  async function amend() {
    setBusy(true);
    setError(null);
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save amendment");
    } finally {
      setBusy(false);
    }
  }

  /** Updates payment status and retains the current note when the request fails. */
  async function setPayment(status: string) {
    setError(null);
    try {
      const token = await getToken();
      if (!token) return;
      await fetchApi(token, `/doctor/appointments/${params.appointmentId}/payment-status`, {
        method: "POST",
        body: JSON.stringify({ payment_status: status }),
      });
      await state.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update payment");
    }
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
            {readOnly ? "Note is finalized (immutable)" : saving ? "Saving…" : dirty ? "Unsaved changes" : savedAt ? `Saved ${savedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "No changes"}
          </span>
        </div>
      </header>

      {error && (
        <div role="alert" className="clinix-doctor-card p-4 font-sans text-sm text-critical">
          <p>{error}</p>
          {dirty && !readOnly && !confirmComplete && (
            <button type="button" disabled={busy || saving} onClick={() => {
              void saveNote(sections).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not save note"));
            }} className="mt-2 underline">Retry save</button>
          )}
        </div>
      )}

      {/* Structured clinical note */}
      <section className="clinix-doctor-card p-5">
        <div className="flex items-center justify-between">
          <p className="clinix-label text-copper">Clinical note</p>
          <span className="font-sans text-[11px] text-doctor-muted/60">
            {readOnly ? "Read-only" : "800ms autosave"}
          </span>
        </div>

        {readOnly && !amending ? (
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
          <fieldset disabled={busy || confirmComplete} className="mt-4 min-w-0 space-y-4">
            {SECTIONS.map((s) => (
              <div key={s.key}>
                <label htmlFor={`note-${s.key}`} className="font-sans text-xs font-semibold uppercase tracking-wider text-doctor-muted/75">
                  {s.label}
                </label>
                <textarea
                  id={`note-${s.key}`}
                  value={sections[s.key] ?? ""}
                  onChange={(e) => {
                    const next = { ...sections, [s.key]: e.target.value };
                    latestSections.current = next;
                    setSections(next);
                    setDirty(true);
                  }}
                  rows={3}
                  className="mt-1.5 w-full rounded-2xl border border-white/10 bg-doctor-panel px-3.5 py-2.5 font-sans text-sm text-surface outline-none focus:border-copper"
                />
              </div>
            ))}
          </fieldset>
        )}
      </section>

      {ctx.note_amendments && ctx.note_amendments.length > 0 && (
        <section className="clinix-doctor-card p-5">
          <p className="clinix-label text-copper">Amendment history</p>
          {ctx.note_amendments.map((amendment) => (
            <article key={amendment.id} className="mt-4 border-t border-white/10 pt-3 font-sans text-sm text-doctor-muted/80">
              <p>{fmtAt(amendment.created_at)}</p>
              <p className="break-all text-xs">Doctor: {amendment.doctor_id}</p>
              <p className="mt-1 whitespace-pre-wrap">Reason: {amendment.reason}</p>
              <dl className="mt-2 space-y-2">
                {SECTIONS.map((section) => (
                  <div key={section.key}>
                    <dt className="font-semibold text-surface">{section.label}</dt>
                    <dd className="whitespace-pre-wrap">{amendment.sections[section.key] || "—"}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </section>
      )}

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
              <label htmlFor="amend-reason" className="mt-2 block font-sans text-xs text-doctor-muted/80">Reason for amendment *</label>
              <input
                id="amend-reason"
                disabled={busy}
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
                  disabled={busy}
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
              onClick={() => {
                const latest = ctx.note_amendments?.[0]?.sections ?? ctx.note ?? {};
                setSections(latest);
                latestSections.current = latest;
                setAmending(true);
              }}
              className="min-h-[52px] w-full rounded-[1.25rem] border border-white/10 bg-doctor-panel px-4 font-sans text-sm font-semibold text-surface"
            >
              Amend note
            </button>
          )
        ) : (
          <button
            ref={completeButton}
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
        <ClinicalReviewDialog
          titleId="complete-consult-title"
          busy={busy}
          returnFocusRef={completeButton}
          onClose={() => setConfirmComplete(false)}
        >
          <div>
            <span className="rounded-full border border-copper/50 px-2.5 py-1 font-sans text-[10px] font-bold uppercase text-copper">
              Final Review
            </span>
            <h3 id="complete-consult-title" className="mt-5 font-sans text-[28px] leading-tight font-semibold text-surface">
              Complete consultation?
            </h3>
            <p className="mt-2 font-sans text-xs leading-5 text-doctor-muted/75">
              Confirm the encounter record before it becomes completed.
            </p>
            <section className="mt-6 rounded-[22px] border border-copper bg-graphite p-4 font-sans text-xs text-surface">
              <h4 className="text-xl">{ctx.appointment.patient_name}</h4>
              <dl className="mt-4 space-y-2">
                <div className="flex gap-3"><dt className="w-20 text-copper">Time</dt><dd>{fmtAt(ctx.appointment.scheduled_start)}</dd></div>
                <div className="flex gap-3"><dt className="w-20 text-copper">Reason</dt><dd>{ctx.appointment.reason || "—"}</dd></div>
                <div className="flex gap-3"><dt className="w-20 text-copper">Payment</dt><dd>{ctx.appointment.payment_status}</dd></div>
              </dl>
            </section>
            <div className="mt-6 space-y-3 rounded-[22px] border border-copper bg-graphite p-4 font-sans text-xs text-surface">
              <p>The latest note will be saved before completion.</p>
              <dl className="space-y-3">
                {SECTIONS.map((section) => (
                  <div key={section.key}>
                    <dt className="font-semibold">{section.label}</dt>
                    <dd className="whitespace-pre-wrap break-words">{sections[section.key] || "—"}</dd>
                  </div>
                ))}
              </dl>
            </div>
            {error && <p role="alert" className="mt-3 font-sans text-sm text-critical">{error}</p>}
            <section className="mt-6 rounded-[22px] border border-evidence bg-graphite p-4 font-sans text-xs leading-5 text-surface">
              <h4 className="text-lg">Completed notes are locked</h4>
              <p className="mt-2">Later corrections are added as dated amendments. The original finalized note remains preserved.</p>
            </section>
            <p className="mt-5 font-sans text-xs leading-5 text-surface">This changes the encounter and appointment status to Completed.</p>
            <div className="mt-6 flex flex-col gap-3">
              <button
                type="button"
                onClick={complete}
                disabled={busy}
                className="min-h-[60px] rounded-[18px] bg-copper font-sans text-xs font-semibold uppercase text-ink disabled:opacity-60"
              >
                {busy ? "Finalizing…" : "Complete consultation"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmComplete(false)}
                disabled={busy}
                className="min-h-[52px] rounded-[18px] border border-copper font-sans text-xs font-semibold text-surface"
              >
                Return to draft
              </button>
            </div>
          </div>
        </ClinicalReviewDialog>
      )}
    </WorkspaceShell>
  );
}
