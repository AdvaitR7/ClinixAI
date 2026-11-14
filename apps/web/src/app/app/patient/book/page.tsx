"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type {
  AppointmentType,
  AvailabilitySlot,
  ConsentView,
  DoctorOption,
  PatientAppointmentView,
} from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { recordHref } from "@/lib/route-params";
import { expiryText, scopeSummary } from "@/lib/privacy";
import { WorkspaceShell } from "@/components/workspace-shell";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import {
  PatientVisitHeader,
  patientVisitNav,
} from "@/components/patient-visit-header";

const card = "rounded-[24px] border border-sage bg-surface p-4 shadow-sm";
const label = "text-xs text-graphite uppercase";

/** Formats appointment times in the prototype's fixed India timezone. */
function visitTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
  });
}
/** Returns a date-only key in the same timezone as the availability service. */
function visitDay() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
/** Makes four real calendar choices without inventing published availability. */
function daysFrom(day: string) {
  return Array.from({ length: 4 }, (_, i) => {
    const date = new Date(`${day}T12:00:00+05:30`);
    date.setUTCDate(date.getUTCDate() + i);
    return {
      date: date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }),
      weekday: date.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
      }),
      number: date.toLocaleDateString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "numeric",
      }),
    };
  });
}

/** Keeps query-driven booking entry inside the App Router suspense boundary. */
export default function BookPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          Loading booking…
        </p>
      }
    >
      <BookingEntry />
    </Suspense>
  );
}

/** Restores only an owned, cancelled appointment for the approved cancel-and-rebook flow. */
function BookingEntry() {
  const query = useSearchParams();
  const doctors = useApiData<DoctorOption[]>("/doctors");
  const rebookId = query.get("rebook");
  const previous = useApiData<PatientAppointmentView[]>(
    rebookId ? "/patients/self/appointments" : null,
  );
  if (doctors.status !== "ready" || (rebookId && previous.status !== "ready")) {
    const error =
      doctors.status === "error"
        ? doctors.error
        : previous.status === "error"
          ? previous.error
          : null;
    return (
      <WorkspaceShell
        workspace="Patient"
        title="Book appointment"
        nav={patientVisitNav}
        focused
        flowNavigation
        hideHeading
      >
        <h1 className="text-2xl">Consultation booking</h1>
        {error ? (
          <>
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
            <button
              type="button"
              onClick={() => {
                void doctors.refresh();
                if (rebookId) void previous.refresh();
              }}
              className="min-h-11 text-sm underline"
            >
              Retry booking data
            </button>
          </>
        ) : (
          <p role="status">Loading booking…</p>
        )}
        <Link
          href="/app/patient/appointments"
          className="block min-h-11 text-sm underline"
        >
          Return to appointments
        </Link>
      </WorkspaceShell>
    );
  }
  const old =
    rebookId && previous.status === "ready"
      ? previous.data.find((a) => a.id === rebookId && a.status === "CANCELLED")
      : undefined;
  if (rebookId && !old)
    return (
      <WorkspaceShell
        workspace="Patient"
        title="Book appointment"
        nav={patientVisitNav}
        focused
        flowNavigation
      >
        <p role="alert">
          The cancelled appointment is unavailable in your record.
        </p>
        <Link
          href="/app/patient/appointments"
          className="block min-h-11 underline"
        >
          Return to appointments
        </Link>
      </WorkspaceShell>
    );
  return (
    <BookingForm
      key={rebookId ?? query.get("doctorId") ?? "new"}
      doctors={doctors.data}
      initialDoctorId={old?.doctor_id ?? query.get("doctorId") ?? ""}
      previous={old}
      initialConsentId={query.get("consentId")}
      encounterId={query.get("encounterId")}
    />
  );
}

/** Loads slots in a keyed component so a late response cannot populate another doctor's selection. */
function AvailableSlots({
  doctorId,
  date,
  mode,
  selected,
  onSelect,
}: {
  doctorId: string;
  date: string;
  mode: AppointmentType;
  selected: AvailabilitySlot | null;
  onSelect: (slot: AvailabilitySlot) => void;
}) {
  const [loadedAt] = useState(Date.now);
  const state = useApiData<{ slots: AvailabilitySlot[] }>(
    `/doctors/${doctorId}/availability?from=${date}&to=${date}&type=${mode}`,
  );
  if (state.status === "loading")
    return (
      <p role="status" className="text-xs text-graphite">
        Loading available times…
      </p>
    );
  if (state.status === "error")
    return (
      <div>
        <p role="alert" className="text-xs text-critical">
          {state.error}
        </p>
        <button
          type="button"
          onClick={() => void state.refresh()}
          className="mt-2 min-h-11 text-xs underline"
        >
          Retry availability
        </button>
      </div>
    );
  const slots = state.data.slots.filter(
    (slot) => new Date(slot.start).getTime() > loadedAt,
  );
  if (!slots.length)
    return (
      <p className="text-xs text-graphite">
        No future slots are available on this date. Choose another date.
      </p>
    );
  return (
    <div
      className="grid grid-cols-2 gap-3"
      role="group"
      aria-label="Available times"
    >
      {slots.map((slot) => (
        <button
          key={slot.start}
          type="button"
          aria-pressed={selected?.start === slot.start}
          onClick={() => onSelect(slot)}
          className={`min-h-11 rounded-2xl border px-3 text-xs ${selected?.start === slot.start ? "border-botanical bg-botanical text-surface" : "border-sage bg-surface text-ink"}`}
        >
          {visitTime(slot.start)}
        </button>
      ))}
    </div>
  );
}

/** Builds and reviews a real visit request; unavailable sharing/draft services never report success. */
function BookingForm({
  doctors,
  initialDoctorId,
  previous,
  initialConsentId,
  encounterId,
}: {
  doctors: DoctorOption[];
  initialDoctorId: string;
  previous?: PatientAppointmentView;
  initialConsentId: string | null;
  encounterId: string | null;
}) {
  const { getToken } = useAuth();
  const router = useRouter();
  const [doctorId, setDoctorId] = useState(initialDoctorId);
  const [mode, setMode] = useState<AppointmentType>(
    previous?.appointment_type ?? "IN_PERSON",
  );
  const [date, setDate] = useState(visitDay);
  const [calendarStart, setCalendarStart] = useState(visitDay);
  const [slot, setSlot] = useState<AvailabilitySlot | null>(null);
  const [reason, setReason] = useState(previous?.reason ?? "");
  const [reviewing, setReviewing] = useState(false);
  const [dialog, setDialog] = useState<"doctor" | "reason" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const actionRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const doctor = doctors.find((item) => item.doctor_id === doctorId);
  // A sharing permission granted on the scope picker for the selected doctor; booking only references it.
  const consents = useApiData<ConsentView[]>("/patients/self/consents");
  const sharing =
    consents.status === "ready" && Array.isArray(consents.data)
      ? consents.data.find(
          (c) => c.id === initialConsentId && c.doctor_id === doctorId && c.status === "ACTIVE",
        )
      : undefined;
  const shareHref = recordHref("/app/patient/care/share", "doctorId", doctorId, { from: "book", ...(encounterId ? { encounterId } : {}) });
  const days = daysFrom(calendarStart);

  /** Associates native-dialog focus return with the exact invoking control. */
  function openDialog(
    kind: "doctor" | "reason",
    button: HTMLButtonElement,
  ) {
    actionRef.current = button;
    setDialog(kind);
  }
  /** Invalidates a selected slot whenever its doctor, date or visit mode changes. */
  function clearSelection() {
    setSlot(null);
    setError(null);
  }
  /** Sends exactly the reviewed mode/time/reason, omitting an empty optional reason. */
  async function book() {
    if (!doctor || !slot || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      const response = await fetchApi<{ appointment: { id: string } }>(
        token,
        "/patients/self/appointments",
        {
          method: "POST",
          body: JSON.stringify({
            doctor_id: doctor.doctor_id,
            appointment_type: mode,
            scheduled_start: slot.start,
            ...(reason.trim() ? { reason: reason.trim() } : {}),
            ...(sharing ? { consent_id: sharing.id } : {}),
          }),
        },
      );
      if (mounted.current)
        router.replace(
          `/app/patient/appointments?booked=${encodeURIComponent(response.appointment.id)}`,
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Booking failed. Your selection is retained.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  /** Returns to editable visit details and refreshes availability after a failed confirmation. */
  function editBooking() {
    if (busy) return;
    setReviewing(false);
    if (error) {
      setSlot(null);
      setReload((n) => n + 1);
    }
    setError(null);
  }

  const scope = (
    <section className={`${card} ring-[5px] ring-sage/25`}>
      <p className={label}>Scoped consultation packet</p>
      <h2 className="mt-3 text-lg">
        {sharing ? "Records shared with this doctor" : "No records attached"}
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-graphite">
        {sharing
          ? `${scopeSummary(sharing)}. ${expiryText(sharing)}.`
          : "Booking this visit does not grant access to your check-ins, reports, medicines or timeline unless you choose to share them."}
      </p>
      {doctor && (
        <Link href={shareHref} className="mt-3 flex min-h-11 w-full items-center justify-end text-xs text-clear-info">
          {sharing ? "Change what is shared →" : "Choose what to share →"}
        </Link>
      )}
    </section>
  );
  const receipt = (
    <section className={card}>
      <p className={label}>Sharing status</p>
      <h2 className="mt-3 text-base">
        {sharing ? "Sharing permission active" : "No sharing permission selected"}
      </h2>
      <dl className="mt-3 space-y-3 border-t border-sage pt-3 text-xs">
        <div className="flex justify-between gap-4">
          <dt className="text-graphite">Recipient</dt>
          <dd>{doctor ? `Dr. ${doctor.name}` : "Not selected"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-graphite">Record scope</dt>
          <dd className="text-right">{sharing ? scopeSummary(sharing) : "None shared by this booking"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-graphite">Expiry</dt>
          <dd>{sharing ? expiryText(sharing) : "Not applicable"}</dd>
        </div>
      </dl>
    </section>
  );
  return (
    <WorkspaceShell
      workspace="Patient"
      title="Book appointment"
      nav={patientVisitNav}
      focused
      flowNavigation
      hideHeading
      headerContent={
        <PatientVisitHeader
          onBack={reviewing ? editBooking : undefined}
          busy={busy}
          action={
            reviewing ? (
              <button
                type="button"
                onClick={editBooking}
                disabled={busy}
                className="min-h-11 disabled:opacity-50"
              >
                Edit
              </button>
            ) : (
              <Link
                href="/app/patient/appointments"
                className="inline-flex min-h-11 items-center"
              >
                Cancel
              </Link>
            )
          }
        />
      }
    >
      <div>
        <p className="w-fit rounded-full border border-sage bg-surface px-5 py-2 text-xs uppercase">
          {reviewing
            ? "Review before booking"
            : "Consultation booking · packet"}
        </p>
        <h1 className="mt-4 text-[30px] leading-tight">
          {reviewing ? "Review consultation" : "Consultation booking"}
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-graphite">
          {reviewing
            ? "Confirm the visit details below."
            : "Choose the doctor, visit mode and an available time."}
        </p>
      </div>
      {previous && (
        <p
          role="status"
          className="rounded-2xl bg-surface p-4 text-xs text-graphite"
        >
          The previous visit was cancelled. Choose and confirm a new time to
          create a new request.
        </p>
      )}
      {!reviewing ? (
        <>
          <section className={`${card} ring-[5px] ring-sage/25`}>
            <p className={label}>Selected doctor</p>
            <div className="mt-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-base">
                  {doctor ? `Dr. ${doctor.name}` : "Choose a doctor"}
                </h2>
                <p className="mt-1 text-xs text-graphite">
                  {doctor?.speciality ?? "Speciality unavailable"}
                </p>
              </div>
              {doctor && (
                <span className="rounded-full border border-clear-info px-2 py-1 text-xs text-graphite">
                  {doctor.verification_status?.replaceAll("_", " ") ??
                    "VERIFICATION UNKNOWN"}
                </span>
              )}
            </div>
            {doctor && doctor.verification_status !== "VERIFIED" && (
              <p className="mt-3 text-xs text-graphite">
                Booking is permitted under the demo policy; verification is not
                confirmed.
              </p>
            )}
            <button
              type="button"
              onClick={(e) => openDialog("doctor", e.currentTarget)}
              className="mt-2 min-h-11 w-full text-right text-xs text-clear-info"
            >
              {doctor ? "Change doctor →" : "Select doctor →"}
            </button>
            {initialDoctorId && !doctor && (
              <p role="alert" className="text-xs text-critical">
                The requested doctor is unavailable. Select a doctor explicitly.
              </p>
            )}
          </section>
          <section>
            <h2 className={label}>1 · Visit mode</h2>
            <div
              className="mt-3 grid grid-cols-2 gap-3"
              role="group"
              aria-label="Visit mode"
            >
              {(["ONLINE", "IN_PERSON"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    clearSelection();
                  }}
                  className={`min-h-[100px] rounded-[20px] border p-4 text-left ${mode === value ? "border-botanical bg-botanical text-surface" : "border-sage bg-surface text-ink"}`}
                >
                  <span aria-hidden="true">{mode === value ? "●" : "○"}</span>
                  <span className="mt-2 block text-sm">
                    {value === "ONLINE" ? "Online video" : "In-person"}
                  </span>
                  <span className="mt-1 block text-xs">
                    {value === "ONLINE"
                      ? "Video provider unavailable"
                      : "Clinic address unavailable"}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 rounded-2xl bg-surface p-3 text-xs leading-relaxed text-graphite">
              {mode === "ONLINE"
                ? "Online appointments can be requested. This app cannot create a video join link."
                : "Clinic location has not been provided. Directions cannot be generated."}
            </p>
          </section>
          <section>
            <h2 className={label}>2 · Date &amp; slot</h2>
            <label
              className="mt-3 block text-xs text-graphite"
              htmlFor="booking-date"
            >
              Choose date (India time)
            </label>
            <input
              id="booking-date"
              type="date"
              min={visitDay()}
              value={date}
              onChange={(e) => {
                if (!e.target.value) return;
                setDate(e.target.value);
                setCalendarStart(e.target.value);
                clearSelection();
              }}
              className="clinix-field mt-2 text-sm"
            />
            <div className="mt-3 grid grid-cols-4 gap-2">
              {days.map((day) => (
                <button
                  key={day.date}
                  type="button"
                  aria-label={day.date}
                  aria-pressed={date === day.date}
                  onClick={() => {
                    setDate(day.date);
                    clearSelection();
                  }}
                  className={`min-h-[70px] rounded-[18px] border p-2 ${date === day.date ? "border-botanical bg-botanical text-surface" : "border-sage bg-surface"}`}
                >
                  <span className="block text-xs uppercase">
                    {day.weekday}
                  </span>
                  <span className="mt-1 block text-xl">{day.number}</span>
                </button>
              ))}
            </div>
            <div className="mt-4">
              {doctor && date ? (
                <AvailableSlots
                  key={`${doctorId}-${date}-${mode}-${reload}`}
                  doctorId={doctorId}
                  date={date}
                  mode={mode}
                  selected={slot}
                  onSelect={setSlot}
                />
              ) : (
                <p className="text-xs text-graphite">
                  Select a doctor to see available times.
                </p>
              )}
            </div>
          </section>
          <section>
            <h2 className={label}>3 · Reason for visit</h2>
            <div className={`${card} mt-3`}>
              <p className="text-xs text-graphite uppercase">
                Chief complaint · optional
              </p>
              <p className="mt-3 break-words text-base">
                {reason || "No reason provided"}
              </p>
              <button
                type="button"
                onClick={(e) => openDialog("reason", e.currentTarget)}
                className="mt-2 min-h-11 w-full text-right text-xs text-clear-info"
              >
                Edit reason →
              </button>
            </div>
          </section>
          <section>
            <h2 className={`${label} mb-4`}>4 · Scoped consultation packet</h2>
            {scope}
          </section>
          {receipt}
          <p className="rounded-2xl bg-surface p-4 text-xs leading-relaxed text-graphite">
            Nothing is booked until you review and confirm. No payment is taken
            here; the doctor or clinic sets payment status.
          </p>
          <button
            type="button"
            onClick={() => {
              setReviewing(true);
              setError(null);
              window.scrollTo(0, 0);
            }}
            disabled={!doctor || !slot}
            className="min-h-[54px] w-full rounded-[20px] bg-botanical px-4 text-sm text-surface disabled:opacity-50"
          >
            REVIEW BOOKING
          </button>
          <div className="text-center">
            <button
              type="button"
              disabled
              className="min-h-11 text-xs text-graphite/60"
            >
              Save as draft unavailable
            </button>
            <p className="text-xs text-graphite">
              Draft storage is not supported. Leaving this page discards
              unsubmitted details.
            </p>
          </div>
        </>
      ) : (
        <>
          <section className={card}>
            <p className={label}>Visit details</p>
            <h2 className="mt-4 text-lg">Dr. {doctor?.name}</h2>
            <p className="mt-1 text-xs text-graphite">
              {doctor?.speciality ?? "Speciality unavailable"} ·{" "}
              {doctor?.verification_status ?? "Verification unknown"}
            </p>
            <dl className="mt-4 space-y-4 border-t border-sage pt-4 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-graphite">Mode</dt>
                <dd>
                  {mode === "ONLINE"
                    ? "Online video · provider unavailable"
                    : "In-person"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-graphite">Date &amp; time</dt>
                <dd className="text-right">
                  {date} · {slot ? visitTime(slot.start) : "Not selected"}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-graphite">Reason</dt>
                <dd className="max-w-[210px] break-words text-right">
                  {reason.trim() || "Not provided"}
                </dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={editBooking}
              disabled={busy}
              className="mt-3 min-h-11 w-full text-right text-xs text-clear-info disabled:opacity-50"
            >
              Edit visit details →
            </button>
          </section>
          {scope}
          {receipt}
          <p className="rounded-2xl bg-surface p-4 text-xs leading-relaxed text-graphite">
            Confirming creates a request for the doctor&apos;s approval. No records
            or payment are transferred.
          </p>
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-critical p-4 text-sm text-critical"
            >
              {error}
              <button
                type="button"
                onClick={editBooking}
                className="mt-3 block min-h-11 underline"
              >
                Choose another time
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void book()}
            disabled={busy}
            className="min-h-[58px] w-full rounded-[20px] bg-botanical px-4 text-sm text-surface disabled:opacity-50"
          >
            {busy ? "REQUESTING…" : "CONFIRM BOOKING"}
          </button>
          <button
            type="button"
            onClick={editBooking}
            disabled={busy}
            className="min-h-11 w-full text-xs text-clear-info disabled:opacity-50"
          >
            Back to edit
          </button>
        </>
      )}
      {dialog && (
        <ClinicalReviewDialog
          titleId="booking-dialog-title"
          busy={false}
          returnFocusRef={actionRef}
          onClose={() => setDialog(null)}
        >
          <h2 id="booking-dialog-title" className="text-xl">
            {dialog === "doctor"
              ? "Select doctor"
              : "Reason for visit"}
          </h2>
          {dialog === "doctor" && (
            <div className="mt-4 space-y-3">
              {doctors.length ? (
                doctors.map((item) => (
                  <button
                    key={item.doctor_id}
                    type="button"
                    aria-pressed={doctorId === item.doctor_id}
                    onClick={() => {
                      setDoctorId(item.doctor_id);
                      clearSelection();
                      setDialog(null);
                    }}
                    className="min-h-16 w-full rounded-xl border border-sage p-3 text-left"
                  >
                    <span className="block text-sm">Dr. {item.name}</span>
                    <span className="mt-1 block text-xs">
                      {item.speciality ?? "Speciality unavailable"} ·{" "}
                      {item.verification_status ?? "Verification unknown"}
                    </span>
                  </button>
                ))
              ) : (
                <p>No doctors are available for booking.</p>
              )}
            </div>
          )}
          {dialog === "reason" && (
            <>
              <label htmlFor="booking-reason" className="mt-4 block text-xs">
                Reason (optional)
              </label>
              <textarea
                id="booking-reason"
                maxLength={1000}
                rows={5}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="clinix-field mt-2 text-sm"
              />
              <button
                type="button"
                onClick={() => setDialog(null)}
                className="mt-4 min-h-11 rounded-xl bg-clear-action px-4 text-sm text-white"
              >
                Use this reason
              </button>
            </>
          )}
        </ClinicalReviewDialog>
      )}
    </WorkspaceShell>
  );
}
