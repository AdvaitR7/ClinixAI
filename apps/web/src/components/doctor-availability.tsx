"use client";

import { useRef, useState } from "react";
import { doctorAvailabilitySchema, type DoctorAvailabilityView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { scheduleCard } from "@/lib/doctor-schedule";

type Window = { day_of_week: number; start_time: string; end_time: string };
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const order = [1, 2, 3, 4, 5, 6, 0];
const inputClass = "min-h-11 min-w-0 rounded-xl border border-copper/60 bg-ink px-2 text-xs text-surface";

/** Loads the doctor's saved configuration; never publishes a hardcoded default work week. */
export function DoctorAvailabilityEditor({ onSaved }: { onSaved: () => void }) {
  const state = useApiData<DoctorAvailabilityView>("/doctors/self/availability");
  return <>
    {state.status === "loading" && <p role="status" className="text-sm">Loading saved availability…</p>}
    {state.status === "error" && <div role="alert" className={scheduleCard}><p className="text-sm">{state.error}</p><button type="button" onClick={() => void state.refresh()} className="mt-3 min-h-11 text-xs text-evidence">Retry availability</button></div>}
    {state.status === "ready" && <AvailabilityForm initial={state.data} onSaved={onSaved} />}
  </>;
}

/** Maintains an in-memory availability draft until the server write and read-back both succeed. */
function AvailabilityForm({ initial, onSaved }: { initial: DoctorAvailabilityView; onSaved: () => void }) {
  const { getToken } = useAuth();
  const [draft, setDraft] = useState(initial);
  const [dialog, setDialog] = useState<"hours" | "breaks" | "online" | "blocked" | "overrides" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const disabledWindows = useRef<Record<number, Window[]>>({});
  const returnFocus = useRef<HTMLButtonElement | null>(null);
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [overrideDate, setOverrideDate] = useState("");
  const [overrideStart, setOverrideStart] = useState("09:00");
  const [overrideEnd, setOverrideEnd] = useState("17:00");

  /** Opens a settings editor without saving or losing other draft settings. */
  function open(next: typeof dialog, button: HTMLButtonElement) {
    returnFocus.current = button; setDialog(next); setError(null);
    if (next === "overrides" && draft.rules.overrides[0]) {
      const row = draft.rules.overrides[0];
      setOverrideDate(row.date); setOverrideStart(row.intervals[0]?.start_time ?? "09:00"); setOverrideEnd(row.intervals[0]?.end_time ?? "17:00");
    }
  }
  /** Restores a disabled day's draft windows rather than overwriting them with default hours. */
  function toggleDay(day: number) {
    const rows = draft.template.filter((row) => row.day_of_week === day);
    if (rows.length) disabledWindows.current[day] = rows;
    setDraft({ ...draft, template: rows.length ? draft.template.filter((row) => row.day_of_week !== day) : [...draft.template, ...(disabledWindows.current[day] ?? [{ day_of_week: day, start_time: "09:00", end_time: "17:00" }])] });
  }
  /** Saves the complete rules and confirms persisted values through the authenticated own read. */
  async function save() {
    if (saving.current) return;
    const parsed = doctorAvailabilitySchema.safeParse({ template: draft.template, slot_duration_minutes: draft.slot_duration_minutes, rules: draft.rules });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the availability settings."); return; }
    saving.current = true; setBusy(true); setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Sign in to save availability.");
      await fetchApi(token, "/doctors/self/availability", { method: "PUT", body: JSON.stringify(parsed.data) });
      const stored = await fetchApi<DoctorAvailabilityView>(token, "/doctors/self/availability");
      setDraft(stored); onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Availability could not be confirmed. Reload before retrying."); }
    finally { saving.current = false; setBusy(false); }
  }
  /** Adds a validated blocked date; an explicit Save is still needed to publish it. */
  function addBlocked() {
    const rules = { ...draft.rules, blocked_dates: [...draft.rules.blocked_dates, { date, reason }] };
    const parsed = doctorAvailabilitySchema.safeParse({ template: draft.template, rules });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Choose a valid blocked date."); return; }
    setDraft({ ...draft, rules }); setDate(""); setReason(""); setError(null);
  }
  /** Adds or replaces the selected date's working windows without changing the recurring week. */
  function addOverride() {
    const rules = { ...draft.rules, overrides: [...draft.rules.overrides.filter((row) => row.date !== overrideDate), { date: overrideDate, intervals: [{ start_time: overrideStart, end_time: overrideEnd }] }] };
    const parsed = doctorAvailabilitySchema.safeParse({ template: draft.template, rules });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the one-off hours."); return; }
    setDraft({ ...draft, rules }); setOverrideDate(""); setError(null);
  }
  const windows = dialog === "breaks" ? draft.rules.breaks : dialog === "online" ? draft.rules.online_template ?? [] : draft.template;
  /** Replaces only the currently edited interval collection, preserving all other rules. */
  function setWindows(value: Window[]) {
    setDraft(dialog === "breaks" ? { ...draft, rules: { ...draft.rules, breaks: value } } : dialog === "online" ? { ...draft, rules: { ...draft.rules, online_template: value } } : { ...draft, template: value });
  }
  return <div className="space-y-8">
    {!initial.configured && <p className="text-xs text-evidence">No availability has been published. Enable working windows before saving.</p>}
    <section><h2 className="mb-3 text-[10px] text-copper">WEEKLY WORKING HOURS</h2><div className={scheduleCard}><ul className="divide-y divide-copper/60">{order.map((day) => {
      const rows = draft.template.filter((row) => row.day_of_week === day);
      return <li key={day} className="flex items-center justify-between gap-3 py-3 text-[11px]"><span>{days[day]}</span><button type="button" disabled={busy} onClick={(event) => open("hours", event.currentTarget)} aria-label={`Edit ${days[day]} working hours`} className="min-h-11 flex-1 text-center">{rows.length ? rows.map((row) => `${row.start_time}–${row.end_time}`).join(", ") : "Closed"}</button><button type="button" aria-label={`${days[day]} enabled`} aria-pressed={rows.length > 0} disabled={busy} onClick={() => toggleDay(day)} className={`min-h-11 min-w-16 rounded-full px-3 text-[8px] ${rows.length ? "bg-copper text-ink" : "border border-copper"}`}>{rows.length ? "ON" : "OFF"}</button></li>;
    })}</ul></div></section>
    <section><h2 className="mb-3 text-[10px] text-copper">VISIT SETTINGS</h2><div className="space-y-3">
      <label className={`${scheduleCard} block text-[9px]`}>Default visit duration (minutes)<input type="number" min={5} max={240} disabled={busy} value={draft.slot_duration_minutes} onChange={(event) => setDraft({ ...draft, slot_duration_minutes: Number(event.target.value) })} className="mt-2 block min-h-11 w-full rounded-xl bg-ink px-3 text-sm" /></label>
      <button type="button" disabled={busy} onClick={(event) => open("breaks", event.currentTarget)} className={`${scheduleCard} block w-full text-left`}><span className="block text-[9px]">Breaks</span><span className="mt-2 block text-sm">{draft.rules.breaks.length ? `${draft.rules.breaks.length} recurring breaks` : "No recurring breaks"}</span><span className="mt-2 block text-[9px] text-copper">Edit →</span></button>
      <div className={scheduleCard}><p className="text-[9px]">Clinic assignment</p><p className="mt-2 text-sm text-doctor-muted/70">Practice location service unavailable</p></div>
    </div></section>
    <section><h2 className="mb-3 text-[10px] text-copper">ONLINE AVAILABILITY</h2><div className={`${scheduleCard} border-evidence`}><p className="text-sm">Online consultations</p><p className="mt-3 text-[11px]">{draft.rules.online_template === null ? "Uses published working hours" : draft.rules.online_template.length ? draft.rules.online_template.map((row) => `${days[row.day_of_week]} ${row.start_time}–${row.end_time}`).join(" · ") : "No online hours"}</p><p className="mt-2 text-[9px]">Online slots stay within working hours. Video joining is not provided.</p><button type="button" disabled={busy} onClick={(event) => open("online", event.currentTarget)} className="mt-2 min-h-11 text-xs text-evidence">Edit online hours</button></div></section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-[10px] text-copper">BLOCKED DATES</h2><button type="button" disabled={busy} onClick={(event) => open("blocked", event.currentTarget)} className="min-h-11 text-xs text-copper">+ Add</button></div><div className={scheduleCard}>{draft.rules.blocked_dates.length ? <ul className="divide-y divide-copper/60">{draft.rules.blocked_dates.map((row) => <li key={row.date} className="flex items-center justify-between gap-3 py-2 text-xs"><span>{row.date}<span className="mt-1 block text-[10px]">{row.reason}</span></span><button type="button" disabled={busy} aria-label={`Remove blocked ${row.date}`} onClick={() => setDraft({ ...draft, rules: { ...draft.rules, blocked_dates: draft.rules.blocked_dates.filter((item) => item.date !== row.date) } })} className="min-h-11 text-evidence">Remove</button></li>)}</ul> : <p className="text-xs">No blocked dates</p>}</div></section>
    <section><div className="mb-3 flex items-center justify-between"><h2 className="text-[10px] text-copper">ONE-OFF CHANGES</h2><button type="button" disabled={busy} onClick={(event) => open("overrides", event.currentTarget)} className="min-h-11 text-xs text-copper">Edit →</button></div><div className={scheduleCard}>{draft.rules.overrides.length ? <ul className="divide-y divide-copper/60">{draft.rules.overrides.map((row) => <li key={row.date} className="flex items-center justify-between gap-3 py-2 text-xs"><span>{row.date}<span className="mt-2 block">{row.intervals.length ? row.intervals.map((item) => `${item.start_time}–${item.end_time}`).join(", ") : "Closed for this date"}</span></span><button type="button" disabled={busy} aria-label={`Remove override ${row.date}`} onClick={() => setDraft({ ...draft, rules: { ...draft.rules, overrides: draft.rules.overrides.filter((item) => item.date !== row.date) } })} className="min-h-11 text-evidence">Remove</button></li>)}</ul> : <p className="text-xs">No one-off changes</p>}<p className="mt-4 border-t border-copper/60 pt-3 text-[9px]">One-off hours replace recurring working windows for that date. Blocked dates stay closed.</p></div></section>
    {error && !dialog && <p role="alert" className="text-sm text-evidence">{error}</p>}
    <button type="button" disabled={busy} onClick={() => void save()} className="flex min-h-14 w-full items-center justify-between rounded-[20px] bg-copper px-5 text-[13px] text-ink disabled:opacity-50">{busy ? "Saving and verifying…" : "SAVE AVAILABILITY"}<span aria-hidden="true">→</span></button>
    {dialog && <ClinicalReviewDialog titleId="availability-edit-title" busy={false} onClose={() => setDialog(null)} returnFocusRef={returnFocus}>
      <h2 id="availability-edit-title" className="text-xl">{dialog === "hours" ? "Working hours" : dialog === "breaks" ? "Recurring breaks" : dialog === "online" ? "Online hours" : dialog === "blocked" ? "Blocked dates" : "One-off hours"}</h2>
      {["hours", "breaks", "online"].includes(dialog) && <div className="mt-5 space-y-4">
        {dialog === "online" && <label className="flex min-h-11 items-center gap-3 text-xs"><input type="checkbox" checked={draft.rules.online_template === null} onChange={(event) => setDraft({ ...draft, rules: { ...draft.rules, online_template: event.target.checked ? null : [] } })} />Use working hours for online slots</label>}
        {(dialog !== "online" || draft.rules.online_template !== null) && <><ul className="space-y-4">{windows.map((row, index) => <li key={index} className="space-y-2 rounded-xl border border-copper/50 p-3"><label className="block text-xs">Day<select aria-label={`Window ${index + 1} day`} value={row.day_of_week} onChange={(event) => setWindows(windows.map((item, i) => i === index ? { ...item, day_of_week: Number(event.target.value) } : item))} className={`${inputClass} ml-3`}>{order.map((day) => <option key={day} value={day}>{days[day]}</option>)}</select></label><div className="grid grid-cols-2 gap-3"><label className="text-xs">Start<input type="time" aria-label={`Window ${index + 1} start`} value={row.start_time} onChange={(event) => setWindows(windows.map((item, i) => i === index ? { ...item, start_time: event.target.value } : item))} className={`${inputClass} mt-1 w-full`} /></label><label className="text-xs">End<input type="time" aria-label={`Window ${index + 1} end`} value={row.end_time} onChange={(event) => setWindows(windows.map((item, i) => i === index ? { ...item, end_time: event.target.value } : item))} className={`${inputClass} mt-1 w-full`} /></label></div><button type="button" onClick={() => setWindows(windows.filter((_, i) => i !== index))} aria-label={`Remove window ${index + 1}`} className="min-h-11 text-xs text-evidence">Remove window</button></li>)}</ul><button type="button" onClick={() => setWindows([...windows, { day_of_week: 1, start_time: "09:00", end_time: "10:00" }])} className="min-h-11 text-xs text-copper">Add window</button></>}
      </div>}
      {dialog === "blocked" && <div className="mt-5 space-y-4"><label className="block text-xs">Blocked date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className={`${inputClass} mt-2 w-full`} /></label><label className="block text-xs">Reason<input value={reason} maxLength={200} onChange={(event) => setReason(event.target.value)} className={`${inputClass} mt-2 w-full`} /></label><button type="button" onClick={addBlocked} className="min-h-11 text-xs text-copper">Add blocked date</button></div>}
      {dialog === "overrides" && <div className="mt-5 space-y-4"><label className="block text-xs">Override date<input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} className={`${inputClass} mt-2 w-full`} /></label><label className="block text-xs">Override start<input type="time" value={overrideStart} onChange={(event) => setOverrideStart(event.target.value)} className={`${inputClass} mt-2 w-full`} /></label><label className="block text-xs">Override end<input type="time" value={overrideEnd} onChange={(event) => setOverrideEnd(event.target.value)} className={`${inputClass} mt-2 w-full`} /></label><button type="button" onClick={addOverride} className="min-h-11 text-xs text-copper">Set one-off hours</button></div>}
      {error && <p role="alert" className="mt-3 text-sm text-evidence">{error}</p>}
      <button type="button" onClick={() => setDialog(null)} className="mt-5 min-h-12 w-full rounded-xl bg-copper text-xs text-ink">Return to availability</button>
    </ClinicalReviewDialog>}
  </div>;
}
