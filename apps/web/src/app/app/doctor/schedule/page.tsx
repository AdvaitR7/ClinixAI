"use client";

import { useAuth } from "@/lib/auth";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AppointmentView } from "@clinix/schemas";
import { WorkspaceShell } from "@/components/workspace-shell";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";
import { fetchApi, useApiData } from "@/lib/api";

const nav = [
  { label: "Home", href: "/app/doctor" },
  { label: "Schedule", href: "/app/doctor/schedule", active: true },
  { label: "Patients", href: "/app/doctor/patients" },
  { label: "Drafts", href: "/app/doctor/drafts" },
  { label: "Follow-ups", href: "/app/doctor/schedule", disabled: true },
];

const FILTERS = [null, "REQUESTED", "CONFIRMED", "COMPLETED", "CANCELLED"] as const;

const DAY_LABELS: Record<number, string> = {
  0: "Sun",
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
};

function fmtDay(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PAYMENT_OPTIONS = ["UNPAID", "REQUESTED", "PAID", "WAIVED", "REFUNDED"];

/** Page 15 — Doctor Schedule (SCREEN_CATALOG §7). */
export default function SchedulePage() {
  const { getToken } = useAuth();
  const router = useRouter();
  const appointments = useApiData<AppointmentView[]>("/doctor/appointments");
  const [tab, setTab] = useState<"schedule" | "availability">("schedule");
  const [filter, setFilter] = useState<string | null>(null);

  async function post(path: string) {
    const token = await getToken();
    if (!token) return;
    await fetchApi(token, path, { method: "POST", body: "{}" });
    await appointments.refresh();
  }

  return (
    <WorkspaceShell workspace="Doctor" title="Schedule" nav={nav}>
      <div className="grid grid-cols-2 gap-1 rounded-[1.125rem] bg-doctor-panel p-1">
        <button
          type="button"
          onClick={() => setTab("schedule")}
          className={`min-h-11 rounded-[0.9rem] px-4 py-2 font-sans text-sm font-semibold ${
            tab === "schedule" ? "bg-copper text-ink" : "bg-doctor-panel text-doctor-muted/75"
          }`}
        >
          Schedule
        </button>
        <button
          type="button"
          onClick={() => setTab("availability")}
          className={`min-h-11 rounded-[0.9rem] px-4 py-2 font-sans text-sm font-semibold ${
            tab === "availability" ? "bg-copper text-ink" : "bg-doctor-panel text-doctor-muted/75"
          }`}
        >
          Availability
        </button>
      </div>

      {tab === "schedule" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f ?? "all"}
                type="button"
                onClick={() => setFilter(f)}
                className={`rounded-full border px-3 py-1 font-sans text-xs font-semibold ${
                  filter === f ? "border-copper bg-copper text-ink" : "border-white/10 text-doctor-muted/75"
                }`}
              >
                {f ?? "All"}
              </button>
            ))}
          </div>

          {appointments.status === "loading" && (
            <div className="space-y-3" aria-hidden="true">
              <Skeleton className="h-20 rounded-2xl" />
              <Skeleton className="h-20 rounded-2xl" />
            </div>
          )}

          {appointments.status === "error" && (
            <p className="font-sans text-sm text-critical">{appointments.error}</p>
          )}

          {appointments.status === "ready" && (
            <AppointmentList
              rows={appointments.data.filter((a) => !filter || a.status === filter)}
              onConfirm={(id) => post(`/doctor/appointments/${id}/confirm`)}
              onCancel={(id) => post(`/appointments/${id}/cancel`)}
              onStart={(id) => router.push(`/app/doctor/consultation/${id}`)}
              onPayment={(id, status) =>
                (async () => {
                  const token = await getToken();
                  if (!token) return;
                  await fetchApi(token, `/doctor/appointments/${id}/payment-status`, {
                    method: "POST",
                    body: JSON.stringify({ payment_status: status }),
                  });
                  await appointments.refresh();
                })()
              }
            />
          )}
        </div>
      )}

      {tab === "availability" && (
        <AvailabilityEditor onSaved={() => setTab("schedule")} />
      )}
    </WorkspaceShell>
  );
}

function AppointmentList({
  rows,
  onConfirm,
  onCancel,
  onPayment,
  onStart,
}: {
  rows: AppointmentView[];
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onPayment: (id: string, status: string) => void;
  onStart: (id: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="font-sans text-sm text-graphite">No appointments match.</p>;
  }
  const grouped = new Map<string, AppointmentView[]>();
  for (const r of rows) {
    const key = fmtDay(r.scheduled_start);
    const list = grouped.get(key) ?? [];
    list.push(r);
    grouped.set(key, list);
  }
  return (
    <div className="space-y-4">
      {[...grouped.entries()].map(([day, list]) => (
        <section key={day}>
          <p className="font-sans text-xs font-semibold uppercase tracking-wide text-graphite">
            {day}
          </p>
          <ul className="mt-2 space-y-2">
            {list.map((a) => (
              <li key={a.id} className="clinix-doctor-card p-4">
                <div className="flex items-center justify-between">
                  <p className="font-sans text-sm font-semibold text-surface">{a.patient_name}</p>
                  <StatusBadge status={a.status} />
                </div>
                <p className="mt-1 font-mono text-xs text-doctor-muted/70">
                  {fmtTime(a.scheduled_start)} · {a.appointment_type}
                  {a.reason ? ` · ${a.reason}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {a.status === "REQUESTED" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onConfirm(a.id)}
                        className="rounded-full bg-copper px-3.5 py-1.5 font-sans text-xs font-semibold text-ink"
                      >
                        Confirm
                      </button>
                      <button
                        type="button"
                        onClick={() => onCancel(a.id)}
                        className="rounded-full border border-critical bg-critical/20 px-3.5 py-1.5 font-sans text-xs font-semibold text-critical"
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {a.status === "CONFIRMED" && (
                    <>
                      <button
                        type="button"
                        onClick={() => onStart(a.id)}
                        className="rounded-full bg-copper px-3.5 py-1.5 font-sans text-xs font-semibold text-ink"
                      >
                        Consult
                      </button>
                      <button
                        type="button"
                        onClick={() => onCancel(a.id)}
                        className="rounded-full border border-critical bg-critical/20 px-3.5 py-1.5 font-sans text-xs font-semibold text-critical"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <label className="ml-auto flex items-center gap-1.5 font-sans text-xs text-doctor-muted/70">
                    Payment
                    <select
                      value={a.payment_status}
                      onChange={(e) => onPayment(a.id, e.target.value)}
                      className="h-8 rounded-lg border border-white/10 bg-doctor-panel px-2 font-sans text-xs text-surface outline-none"
                    >
                      {PAYMENT_OPTIONS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function AvailabilityEditor({ onSaved }: { onSaved: () => void }) {
  const { getToken } = useAuth();
  const [slotMinutes, setSlotMinutes] = useState(30);
  const [days, setDays] = useState<Record<number, { enabled: boolean; start: string; end: string }>>(
    () => {
      const init: Record<number, { enabled: boolean; start: string; end: string }> = {};
      for (let d = 0; d < 7; d++) {
        const weekday = d >= 1 && d <= 5;
        init[d] = { enabled: weekday, start: "09:00", end: "17:00" };
      }
      return init;
    },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Not signed in");
      const template = Object.entries(days)
        .filter(([, v]) => v.enabled)
        .map(([dow, v]) => ({
          day_of_week: Number(dow),
          start_time: v.start,
          end_time: v.end,
        }));
      await fetchApi(token, "/doctors/self/availability", {
        method: "PUT",
        body: JSON.stringify({ template, slot_duration_minutes: slotMinutes }),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save availability");
    } finally {
      setSaving(false);
    }
  }

  const order = [1, 2, 3, 4, 5, 6, 0];

  return (
    <div className="clinix-doctor-card space-y-5 p-5">
      <div>
        <p className="clinix-label text-copper">Weekly availability</p>
        <p className="mt-1 font-sans text-xs leading-5 text-doctor-muted/70">
          Set weekly working hours. Bookable slots are these hours minus booked appointments.
        </p>
      </div>
      <ul className="space-y-3">
        {order.map((dow) => (
          <li key={dow} className="flex items-center gap-3">
            <label className="flex w-16 items-center gap-2 font-sans text-sm text-surface">
              <input
                type="checkbox"
                checked={days[dow].enabled}
                onChange={(e) =>
                  setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], enabled: e.target.checked } }))
                }
                className="h-4 w-4 accent-copper"
              />
              {DAY_LABELS[dow]}
            </label>
            <input
              type="time"
              value={days[dow].start}
              disabled={!days[dow].enabled}
              onChange={(e) =>
                setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], start: e.target.value } }))
              }
              className="h-10 rounded-lg border border-white/10 bg-doctor-panel px-2 font-mono text-sm text-surface disabled:opacity-30"
            />
            <span className="font-sans text-xs text-doctor-muted/60">to</span>
            <input
              type="time"
              value={days[dow].end}
              disabled={!days[dow].enabled}
              onChange={(e) =>
                setDays((prev) => ({ ...prev, [dow]: { ...prev[dow], end: e.target.value } }))
              }
              className="h-10 rounded-lg border border-white/10 bg-doctor-panel px-2 font-mono text-sm text-surface disabled:opacity-30"
            />
          </li>
        ))}
      </ul>
      <div className="border-t border-white/10 pt-4">
        <label htmlFor="slot" className="font-sans text-sm font-medium text-surface">
          Consultation duration (minutes)
        </label>
        <input
          id="slot"
          type="number"
          min={5}
          max={240}
          value={slotMinutes}
          onChange={(e) => setSlotMinutes(Number(e.target.value))}
          className="mt-1 h-11 w-full rounded-xl border border-white/10 bg-doctor-panel px-3 font-mono text-base text-surface"
        />
      </div>
      {error && <p className="font-sans text-sm font-medium text-critical">{error}</p>}
      <button
        type="button"
        onClick={save}
        disabled={saving}
        className="min-h-[52px] w-full rounded-[1.25rem] bg-copper px-4 font-sans text-sm font-semibold uppercase text-ink transition-transform active:translate-y-px disabled:opacity-60"
      >
        {saving ? "Saving…" : "Save availability"}
      </button>
    </div>
  );
}
