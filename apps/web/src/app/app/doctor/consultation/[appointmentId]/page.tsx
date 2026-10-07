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
  { label: "Home", href: "/app/doctor" },
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

/** Page 18 — Consultation workspace (SCREEN_CATALOG §7). */
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
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
      </WorkspaceShell>
    );
  }

  if (state.status === "error") {
    return (
      <WorkspaceShell workspace="Doctor" title="Consultation" nav={nav}>
        <p className="font-sans text-sm text-critical">{state.error}</p>
      </WorkspaceShell>
    );
  }

  const ctx = state.data;
  const readOnly = ctx.note_is_final;

  return (
    <WorkspaceShell workspace="Doctor" title="Consultation" nav={nav}>
      <header className="rounded-2xl bg-botanical p-5 text-surface">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-sans text-lg font-semibold">{ctx.appointment.patient_name}</p>
            <p className="mt-1 font-mono text-xs text-sage">
              {fmtAt(ctx.appointment.scheduled_start)} · {ctx.appointment.appointment_type}
              {ctx.appointment.reason ? ` · ${ctx.appointment.reason}` : ""}
            </p>
          </div>
          <StatusBadge status={ctx.appointment.status} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-sans text-xs text-sage">Payment</span>
          <select
            value={ctx.appointment.payment_status}
            onChange={(e) => setPayment(e.target.value)}
            className="h-8 rounded-lg border border-sage/40 bg-botanical px-1 font-sans text-xs text-surface"
          >
            {PAYMENT_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
      </header>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <div className="flex items-center justify-between">
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
            Clinical note
          </p>
          {!readOnly && (
            <span className="font-sans text-[11px] text-graphite">
              {savedAt ? `Saved · ${savedAt.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Autosaves as you type"}
            </span>
          )}
        </div>

        {readOnly ? (
          <dl className="mt-3 space-y-3">
            {SECTIONS.map((s) => (
              <div key={s.key}>
                <dt className="font-sans text-sm font-medium">{s.label}</dt>
                <dd className="mt-1 font-sans text-sm text-graphite">
                  {ctx.note?.[s.key] || "—"}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="mt-3 space-y-3">
            {SECTIONS.map((s) => (
              <div key={s.key}>
                <label className="font-sans text-sm font-medium">{s.label}</label>
                <textarea
                  value={sections[s.key] ?? ""}
                  onChange={(e) => {
                    setSections((prev) => ({ ...prev, [s.key]: e.target.value }));
                    setDirty(true);
                  }}
                  rows={2}
                  className="mt-1 w-full rounded-xl border border-hairline bg-surface px-3 py-2 font-sans text-base text-ink outline-none focus:border-copper focus:ring-2 focus:ring-copper"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-hairline bg-surface p-5">
        <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
          Current medications
        </p>
        {ctx.current_medications.length === 0 ? (
          <p className="mt-1 font-sans text-sm text-graphite">None recorded.</p>
        ) : (
          <ul className="mt-2 space-y-1">
            {ctx.current_medications.map((m, i) => (
              <li key={i} className="font-sans text-sm">
                {m.medicine_name}
                <span className="text-graphite">
                  {" "}
                  · {[m.dose, m.route, m.frequency].filter(Boolean).join(" · ") || "no details"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() =>
            router.push(
              `/app/doctor/prescription-drafts/new?encounterId=${ctx.encounter_id}&patientId=${ctx.appointment.patient_id}`,
            )
          }
          className="flex-1 rounded-full bg-copper px-4 py-3 font-sans text-base font-semibold text-botanical transition-transform active:translate-y-px"
        >
          Create prescription
        </button>
      </div>

      {readOnly ? (
        amending ? (
          <section className="rounded-2xl border border-hairline bg-surface p-5">
            <p className="font-sans text-sm font-semibold">Amend note</p>
            <label className="mt-2 block font-sans text-sm font-medium">Reason for amendment</label>
            <input
              type="text"
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              className="mt-1 h-11 w-full rounded-xl border border-hairline bg-surface px-3 font-sans text-base"
            />
            <div className="mt-3 flex gap-3">
              <button
                type="button"
                onClick={() => setAmending(false)}
                className="flex-1 rounded-full border border-hairline px-4 py-2 font-sans text-sm font-semibold text-graphite"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={amend}
                disabled={busy || !amendReason.trim()}
                className="flex-1 rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
              >
                Save amendment
              </button>
            </div>
          </section>
        ) : (
          <button
            type="button"
            onClick={() => setAmending(true)}
            className="w-full rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite"
          >
            Amend note
          </button>
        )
      ) : confirmComplete ? (
        <section className="rounded-2xl border border-review bg-surface p-5">
          <p className="font-sans text-sm font-semibold text-review">
            Complete this consultation? The note will be finalized and can only be amended afterwards.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() => setConfirmComplete(false)}
              className="flex-1 rounded-full border border-hairline px-4 py-2 font-sans text-sm font-semibold text-graphite"
            >
              Keep working
            </button>
            <button
              type="button"
              onClick={complete}
              disabled={busy}
              className="flex-1 rounded-full bg-botanical px-4 py-2 font-sans text-sm font-semibold text-surface disabled:opacity-60"
            >
              Complete
            </button>
          </div>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmComplete(true)}
          className="w-full rounded-full border border-hairline bg-surface px-4 py-3 font-sans text-base font-semibold text-graphite"
        >
          Complete consultation
        </button>
      )}
    </WorkspaceShell>
  );
}
