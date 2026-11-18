"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import type { AppointmentView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { WorkspaceShell, AccountMenu } from "@/components/workspace-shell";
import { DoctorAvailabilityEditor } from "@/components/doctor-availability";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { readScheduleState, scheduleCard, scheduleHref, scheduleNav, scheduleStatuses, scheduleTime, shiftScheduleDate } from "@/lib/doctor-schedule";

/** Wraps query-driven schedule navigation in the production Suspense boundary. */
export default function SchedulePage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading schedule…</p>}><ScheduleEntry /></Suspense>;
}

/** Remounts private scheduling state on an authenticated identity change. */
function ScheduleEntry() {
  const { identityVersion } = useAuth();
  return <DoctorSchedule key={identityVersion} />;
}

/** Displays the actual day/week calendar, manual visit/payment actions and saved availability editor. */
function DoctorSchedule() {
  const query = useSearchParams();
  const router = useRouter();
  const state = readScheduleState(query);
  const { getToken } = useAuth();
  const appointments = useApiData<AppointmentView[]>("/doctor/appointments");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancel, setCancel] = useState<AppointmentView | null>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const working = useRef(false);
  const weekday = new Date(`${state.date}T00:00:00Z`).getUTCDay();
  const weekStart = shiftScheduleDate(state.date, -((weekday + 6) % 7));
  const rangeStart = state.view === "week" ? weekStart : state.date;
  const rangeEnd = state.view === "week" ? shiftScheduleDate(weekStart, 6) : state.date;
  const rows = (appointments.status === "ready" ? appointments.data : []).filter((row) => {
    const day = new Date(new Date(row.scheduled_start).getTime() + 330 * 60000).toISOString().slice(0, 10);
    return day >= rangeStart && day <= rangeEnd && (!state.status || row.status === state.status);
  }).sort((a, b) => a.scheduled_start.localeCompare(b.scheduled_start));
  const shown = state.view === "day" ? rows.slice(0, 4) : rows;
  const later = state.view === "day" ? rows.slice(4) : [];

  /** Posts one existing manual transition, retaining failures and preventing repeat activation. */
  async function mutate(id: string, action: "confirm" | "cancel" | "payment-status", payment?: string) {
    if (working.current) return;
    working.current = true; setBusy(id); setError(null); setNotice(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to update this appointment.");
      await fetchApi(token, action === "cancel" ? `/appointments/${id}/cancel` : `/doctor/appointments/${id}/${action}`, { method: "POST", body: JSON.stringify(payment ? { payment_status: payment } : {}) });
      setCancel(null); await appointments.refresh(); setNotice(action === "payment-status" ? "Payment status recorded." : action === "confirm" ? "Appointment confirmed." : "Appointment cancelled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not confirm this change. Reload before retrying."); }
    finally { working.current = false; setBusy(null); }
  }
  /** Returns to the current calendar only after the availability write and read-back succeed. */
  function saved() { setNotice("Availability saved and reloaded."); router.push(scheduleHref({ ...state, tab: "schedule" })); }

  return <WorkspaceShell workspace="Doctor" title="Doctor schedule" focused hideHeading nav={scheduleNav} headerAction={<span className="grid size-[38px] place-items-center rounded-full bg-clear-action text-white"><AccountMenu /></span>}>
    <div><p className="text-xs text-clear-action">CLINICAL OPERATIONS · SCHEDULE</p><h1 className="mt-3 text-[30px] leading-tight">{state.tab === "availability" ? "Availability" : "Doctor schedule"}</h1><p className="mt-2 text-[13px] leading-5">{state.tab === "availability" ? "Set your working rhythm, online hours, breaks, and one-off exceptions." : "Day and week planning with consultation and payment states in one place."}</p></div>
    <div className="grid grid-cols-2 gap-1 rounded-[20px] border border-clear-divider clear-glass p-1">{["schedule", "availability"].map((tab) => <Link key={tab} href={scheduleHref({ ...state, tab: tab as "schedule" | "availability" })} aria-current={state.tab === tab ? "page" : undefined} className={`flex min-h-11 items-center justify-center rounded-2xl text-xs ${state.tab === tab ? "bg-clear-action text-white" : "text-clear-secondary"}`}>{tab === "schedule" ? "Schedule" : "Availability"}</Link>)}</div>
    {notice && <p role="status" className="text-xs text-clear-info">{notice}</p>}
    <div hidden={state.tab !== "schedule"} className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex rounded-2xl border border-clear-divider clear-glass p-1">{["day", "week"].map((view) => <Link key={view} href={scheduleHref({ ...state, view: view as "day" | "week", tab: "schedule" })} aria-current={state.view === view ? "page" : undefined} className={`flex min-h-11 min-w-20 items-center justify-center rounded-xl text-xs ${state.view === view ? "bg-clear-action text-white" : ""}`}>{view === "day" ? "Day" : "Week"}</Link>)}</div><label className="text-xs text-clear-action">Schedule date<input type="date" aria-label="Schedule date (India time)" value={state.date} onChange={(event) => { if (event.target.value) router.push(scheduleHref({ ...state, date: event.target.value })); }} className="mt-1 block min-h-11 max-w-40 rounded-xl border border-clear-divider bg-clear-surface px-2 text-xs text-clear-ink" /></label></div>
      <div className="grid grid-cols-5 gap-2">{Array.from({ length: 5 }, (_, i) => shiftScheduleDate(state.date, i - 1)).map((date) => <Link key={date} href={scheduleHref({ ...state, date })} aria-current={state.date === date ? "date" : undefined} aria-label={`Select ${date}`} className={`flex min-h-16 flex-col items-center justify-center gap-2 rounded-[20px] border border-clear-divider ${state.date === date ? "bg-clear-action text-white" : "clear-glass"}`}><span className="text-xs uppercase">{new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" })}</span><span className="text-xl">{Number(date.slice(-2))}</span></Link>)}</div>
      <div className="flex flex-wrap gap-2" aria-label="Appointment status filters">{["", ...scheduleStatuses].map((status) => <Link key={status} href={scheduleHref({ ...state, status })} aria-current={state.status === status ? "page" : undefined} className={`rounded-full border px-3 py-2 text-xs ${state.status === status ? "border-clear-divider bg-clear-action text-white" : "border-clear-divider"}`}>{status || "All"}</Link>)}</div>
      <p className="text-xs text-clear-action">{state.view === "day" ? state.date : `${rangeStart} — ${rangeEnd}`} · {rows.length} APPOINTMENTS</p>
      {error && !cancel && <p role="alert" className="text-sm text-clear-info">{error}</p>}
      {appointments.status === "loading" && <p role="status" className="text-sm">Loading appointments…</p>}
      {appointments.status === "error" && <div role="alert" className={scheduleCard}><p className="text-sm">{appointments.error}</p><button type="button" onClick={() => void appointments.refresh()} className="min-h-11 text-xs text-clear-info">Retry schedule</button></div>}
      {appointments.status === "ready" && !rows.length && <p className={`${scheduleCard} text-sm`}>No appointments match this date and filter.</p>}
      <ul className="space-y-5">{shown.map((row) => <li key={row.id} className="grid grid-cols-[40px_minmax(0,1fr)] gap-2"><span className="pt-4 text-xs">{scheduleTime(row.scheduled_start)}</span><article className={scheduleCard}>
        <div className="flex flex-wrap items-start justify-between gap-2"><h2 className="break-words text-lg">{row.patient_name || "Patient name unavailable"}</h2><span className="rounded-full bg-clear-action px-3 py-1.5 text-xs text-white">{row.status}</span></div><p className="mt-3 break-words text-xs">{row.reason || "Visit reason not recorded"}</p><p className="mt-2 text-xs">{row.appointment_type === "ONLINE" ? "Online consultation" : "In-clinic"}{state.view === "week" ? ` · ${new Date(new Date(row.scheduled_start).getTime() + 330 * 60000).toISOString().slice(0, 10)}` : ""}</p>
        <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-clear-divider pt-3"><span className="text-xs">PAYMENT</span><label className="sr-only" htmlFor={`payment-${row.id}`}>Payment for {row.patient_name}</label><select id={`payment-${row.id}`} disabled={!!busy} value={row.payment_status} onChange={(event) => void mutate(row.id, "payment-status", event.target.value)} className="min-h-11 max-w-full rounded-full border border-clear-divider bg-clear-surface px-3 text-xs">{["UNPAID", "REQUESTED", "PAID", "WAIVED", "REFUNDED"].map((status) => <option key={status}>{status}</option>)}</select></div>
        <div className="mt-3 flex flex-wrap items-center gap-3">{row.status === "REQUESTED" && <button type="button" disabled={!!busy} onClick={() => void mutate(row.id, "confirm")} className="min-h-11 text-xs text-clear-action disabled:opacity-50">Confirm</button>}{["REQUESTED", "CONFIRMED"].includes(row.status) && <button type="button" disabled={!!busy} onClick={(event) => { returnFocus.current = event.currentTarget; setError(null); setCancel(row); }} className="min-h-11 text-xs text-clear-info">{row.status === "REQUESTED" ? "Decline" : "Cancel"}</button>}<Link href={scheduleHref(state, row.id)} className="ml-auto flex min-h-11 items-center text-xs text-clear-info">Open context →</Link></div>
      </article></li>)}</ul>
      <section><h2 className="mb-3 text-xs text-clear-action">ATTENTION SUMMARY</h2><div className="grid grid-cols-3 gap-3">{["waiting >10m", "urgent review", "incomplete"].map((label) => <div key={label} className={`${scheduleCard} px-3`}><p className="text-2xl">—</p><p className="mt-3 text-xs text-clear-action">{label}</p></div>)}</div><p className="mt-3 text-xs text-clear-secondary">Waiting, triage and documentation progress are not recorded by the current scheduling service.</p></section>
      {!!later.length && <section><div className="mb-3 flex justify-between"><h2 className="text-[22px]">Later on this date</h2><span className="text-xs">{later.length} more</span></div><ul className={scheduleCard}>{later.map((row) => <li key={row.id} className="border-b border-clear-divider py-3 last:border-0"><Link href={scheduleHref(state, row.id)} className="flex min-h-11 items-center gap-4 text-xs"><span>{scheduleTime(row.scheduled_start)}</span><span className="min-w-0 flex-1 break-words">{row.patient_name}</span><span className="text-xs">{row.appointment_type}</span></Link></li>)}</ul></section>}
      <p className="rounded-2xl clear-card p-4 text-xs leading-4">Payment states are manually recorded. Changing payment does not confirm, complete or cancel a consultation.</p>
    </div>
    <div hidden={state.tab !== "availability"}><DoctorAvailabilityEditor onSaved={saved} /></div>
    {cancel && <ClinicalReviewDialog titleId="cancel-schedule-title" busy={!!busy} onClose={() => setCancel(null)} returnFocusRef={returnFocus}><h2 id="cancel-schedule-title" className="text-xl">{cancel.status === "REQUESTED" ? "Decline request?" : "Cancel appointment?"}</h2><p className="mt-4 text-sm">{cancel.patient_name} · {scheduleTime(cancel.scheduled_start)}</p><p className="mt-3 text-xs">Payment status is preserved. No refund is issued by this action.</p>{error && <p role="alert" className="mt-4 text-sm text-clear-info">{error}</p>}<div className="mt-5 flex gap-3"><button type="button" disabled={!!busy} onClick={() => setCancel(null)} className="min-h-12 flex-1 rounded-xl border border-clear-divider text-xs">Keep appointment</button><button type="button" disabled={!!busy} onClick={() => void mutate(cancel.id, "cancel")} className="min-h-12 flex-1 rounded-xl bg-clear-action text-xs text-white">{busy ? "Updating…" : "Yes, cancel"}</button></div></ClinicalReviewDialog>}
  </WorkspaceShell>;
}
