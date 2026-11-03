"use client";

import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PatientAppointmentView } from "@clinix/schemas";
import { useAuth } from "@/lib/auth";
import { fetchApi, useApiData } from "@/lib/api";
import { WorkspaceShell } from "@/components/workspace-shell";
import { StatusBadge } from "@/components/status-badge";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import {
  PatientVisitHeader,
  patientVisitNav,
} from "@/components/patient-visit-header";

const tabs = ["Upcoming", "Past", "Cancelled"] as const;
type VisitTab = (typeof tabs)[number];

/** Buckets overdue active requests into history instead of implying a future visit. */
function bucket(appointment: PatientAppointmentView): VisitTab {
  if (appointment.status === "CANCELLED") return "Cancelled";
  if (
    appointment.status === "COMPLETED" ||
    appointment.status === "NO_SHOW" ||
    new Date(appointment.scheduled_start).getTime() < Date.now()
  )
    return "Past";
  return "Upcoming";
}
/** Presents the doctor's manual payment state separately from consultation status. */
function PaymentBadge({ value }: { value: string }) {
  const style =
    value === "PAID"
      ? "border-botanical bg-botanical text-surface"
      : value === "REQUESTED"
        ? "border-evidence text-graphite"
        : value === "WAIVED"
          ? "border-sage text-graphite"
          : "border-copper text-ink";
  return (
    <span className={`rounded-full border px-3 py-1 text-[9px] ${style}`}>
      {value.replaceAll("_", " ")}
    </span>
  );
}

/** Wraps query-driven booking confirmation in a production-safe suspense boundary. */
export default function PatientAppointmentsPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6">
          Loading appointments…
        </p>
      }
    >
      <Appointments />
    </Suspense>
  );
}

/** Lists actual visits and confirms cancellation before the approved cancel-and-rebook transition. */
function Appointments() {
  const { getToken } = useAuth();
  const router = useRouter();
  const query = useSearchParams();
  const state = useApiData<PatientAppointmentView[]>(
    "/patients/self/appointments",
  );
  const [tab, setTab] = useState<VisitTab>("Upcoming");
  const [action, setAction] = useState<{
    appointment: PatientAppointmentView;
    reschedule: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rows = state.status === "ready" ? state.data : [];
  const filtered = rows.filter((row) => bucket(row) === tab);
  const booked = rows.find((row) => row.id === query.get("booked"));

  /** Opens the selected visit's confirmation and retains its keyboard return target. */
  function openAction(
    appointment: PatientAppointmentView,
    reschedule: boolean,
    trigger: HTMLButtonElement,
  ) {
    actionRef.current = trigger;
    setError(null);
    setAction({ appointment, reschedule });
  }
  /** Cancels only after explicit review, preserving failures and never creating a replacement implicitly. */
  async function confirmAction() {
    if (!action || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      await fetchApi(token, `/appointments/${action.appointment.id}/cancel`, {
        method: "POST",
        body: "{}",
      });
      if (!mounted.current) return;
      if (action.reschedule) {
        router.push(
          `/app/patient/book?rebook=${encodeURIComponent(action.appointment.id)}`,
        );
      } else {
        setNotice(
          `Appointment with Dr. ${action.appointment.doctor_name || "your doctor"} was cancelled.`,
        );
        setAction(null);
        setTab("Cancelled");
        await state.refresh();
      }
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Cancellation could not be confirmed. Retry or reload your appointments.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <WorkspaceShell
      workspace="Patient"
      title="Appointments"
      nav={patientVisitNav.map((item) => ({
        ...item,
        active: item.label === "Visits",
      }))}
      focused
      flowNavigation
      hideHeading
      headerContent={
        <PatientVisitHeader
          backHref="/app/patient"
          action={
            <Link
              href="/app/patient/book"
              className="inline-flex min-h-11 items-center rounded-full border border-botanical px-3 text-[10px] text-botanical"
            >
              + Book
            </Link>
          }
        />
      }
    >
      <div>
        <p className="text-[9px] text-graphite uppercase">
          Patient record · appointments
        </p>
        <h1 className="mt-4 text-[30px] leading-tight">Appointments</h1>
        <p className="mt-2 text-xs leading-relaxed text-graphite">
          Upcoming consultations, visit history and manual payment status.
        </p>
      </div>
      {booked && (
        <p
          role="status"
          className="rounded-2xl border border-sage bg-surface p-4 text-xs"
        >
          Your booking is recorded as {booked.status.toLowerCase()}. No health
          records were shared by the booking.
        </p>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-2xl border border-sage bg-surface p-4 text-xs"
        >
          {notice}
        </p>
      )}
      <div
        className="grid grid-cols-3 gap-1 rounded-2xl bg-surface p-1 shadow-sm"
        role="tablist"
        aria-label="Appointment lists"
      >
        {tabs.map((item) => (
          <button
            key={item}
            id={`visits-${item}`}
            type="button"
            role="tab"
            aria-controls="visits-panel"
            aria-selected={tab === item}
            onClick={() => setTab(item)}
            className={`min-h-11 rounded-full text-[10px] ${tab === item ? "bg-botanical text-surface" : "text-graphite"}`}
          >
            {item} · {rows.filter((row) => bucket(row) === item).length}
          </button>
        ))}
      </div>
      <p className="rounded-2xl border border-hairline bg-surface p-4 text-[11px] leading-relaxed text-graphite">
        Payment status is set manually by the doctor or clinic; it is never
        inferred by AI.
      </p>
      {state.status === "loading" && (
        <p role="status" className="text-sm">
          Loading appointments…
        </p>
      )}
      {state.status === "error" && (
        <section className="rounded-2xl border border-critical bg-surface p-4">
          <p role="alert" className="text-sm text-critical">
            {state.error}
          </p>
          <button
            type="button"
            onClick={() => void state.refresh()}
            className="mt-3 min-h-11 text-sm underline"
          >
            Retry appointments
          </button>
        </section>
      )}
      {state.status === "ready" && (
        <section
          id="visits-panel"
          role="tabpanel"
          aria-labelledby={`visits-${tab}`}
          className="space-y-5"
        >
          <h2 className="text-[10px] text-botanical uppercase">{tab}</h2>
          {!filtered.length && (
            <div className="rounded-[24px] border border-dashed border-sage bg-surface p-6 text-center">
              <p className="text-sm">No {tab.toLowerCase()} appointments</p>
              <Link
                href="/app/patient/book"
                className="mt-4 inline-flex min-h-11 items-center text-xs text-botanical underline"
              >
                Book new appointment
              </Link>
            </div>
          )}
          {filtered.map((appointment) => {
            const active =
              appointment.status === "REQUESTED" ||
              appointment.status === "CONFIRMED";
            const online = appointment.appointment_type === "ONLINE";
            return (
              <article
                key={appointment.id}
                className="rounded-[24px] border border-hairline bg-surface p-4 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[9px] text-botanical uppercase">
                    {online ? "Online consultation" : "In-clinic visit"}
                  </p>
                  <PaymentBadge value={appointment.payment_status} />
                </div>
                <h3 className="mt-4 break-words text-xl">
                  {appointment.doctor_name
                    ? `Dr. ${appointment.doctor_name}`
                    : "Doctor name unavailable"}
                </h3>
                <p className="mt-1 text-[11px] text-graphite">
                  {appointment.speciality ?? "Speciality unavailable"}
                </p>
                <div className="mt-4 flex justify-between gap-4 border-t border-hairline pt-3 text-xs">
                  <div>
                    <p className="text-[9px] text-graphite uppercase">
                      Date &amp; time
                    </p>
                    <p className="mt-2">
                      {new Date(appointment.scheduled_start).toLocaleDateString(
                        "en-IN",
                        {
                          timeZone: "Asia/Kolkata",
                          weekday: "long",
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        },
                      )}
                    </p>
                  </div>
                  <p className="self-end whitespace-nowrap">
                    {new Date(appointment.scheduled_start).toLocaleTimeString(
                      "en-IN",
                      {
                        timeZone: "Asia/Kolkata",
                        hour: "2-digit",
                        minute: "2-digit",
                      },
                    )}
                  </p>
                </div>
                <p className="mt-4 text-[9px] text-graphite uppercase">
                  Reason
                </p>
                <p className="mt-2 break-words text-xs">
                  {appointment.reason || "Not provided"}
                </p>
                {!online && (
                  <div className="mt-4">
                    <p className="text-[9px] text-graphite uppercase">
                      Clinic address
                    </p>
                    <div className="mt-2 rounded-2xl border border-hairline bg-canvas p-4 text-xs text-graphite">
                      Clinic address unavailable
                    </div>
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="mb-2 text-[9px] text-graphite uppercase">
                      Consultation
                    </p>
                    <StatusBadge status={appointment.status} />
                  </div>
                  {!online && (
                    <button
                      type="button"
                      disabled
                      className="min-h-11 text-[10px] text-graphite/60"
                    >
                      Open directions unavailable
                    </button>
                  )}
                </div>
                {online && active && (
                  <>
                    <button
                      type="button"
                      disabled
                      className="mt-4 min-h-[46px] w-full rounded-[16px] bg-botanical px-3 text-xs text-surface opacity-50"
                    >
                      JOIN ONLINE CONSULTATION
                    </button>
                    <p className="mt-2 text-[10px] text-graphite">
                      Video provider unavailable; no join link is connected.
                    </p>
                  </>
                )}
                {active && tab === "Upcoming" && (
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={(e) =>
                        openAction(appointment, true, e.currentTarget)
                      }
                      className="min-h-11 text-[10px] text-botanical"
                    >
                      Reschedule
                    </button>
                    <button
                      type="button"
                      onClick={(e) =>
                        openAction(appointment, false, e.currentTarget)
                      }
                      className="min-h-11 text-[10px] text-critical"
                    >
                      Cancel appointment
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </section>
      )}
      <section>
        <h2 className="text-[10px] text-graphite uppercase">Payment states</h2>
        <div className="mt-3 rounded-2xl border border-sage bg-surface p-3">
          <div className="flex flex-wrap gap-2">
            {["PAID", "REQUESTED", "UNPAID", "WAIVED"].map(
              (value) => (
                <PaymentBadge key={value} value={value} />
              ),
            )}
          </div>
          <p className="mt-3 text-[10px] text-graphite">
            Set manually by the doctor or clinic; never inferred by AI.
          </p>
        </div>
      </section>
      {action && (
        <ClinicalReviewDialog
          titleId="visit-action-title"
          busy={busy}
          returnFocusRef={actionRef}
          onClose={() => {
            if (!busy) setAction(null);
          }}
        >
          <h2 id="visit-action-title" className="text-xl">
            {action.reschedule
              ? "Choose another appointment time?"
              : "Cancel appointment?"}
          </h2>
          <p className="mt-4 text-sm">
            Dr. {action.appointment.doctor_name} ·{" "}
            {new Date(action.appointment.scheduled_start).toLocaleString(
              "en-IN",
              { timeZone: "Asia/Kolkata" },
            )}
          </p>
          <p className="mt-4 text-sm leading-relaxed">
            {action.reschedule
              ? "Rescheduling uses cancel and re-book. This cancels the current visit first. A replacement is not reserved until you choose and confirm a new time."
              : "This cancels the selected appointment and releases its slot. No payment refund is performed by this action."}
          </p>
          {error && (
            <p role="alert" className="mt-4 text-sm text-copper">
              {error}
            </p>
          )}
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={() => void confirmAction()}
              disabled={busy}
              className="min-h-12 w-full rounded-xl bg-critical px-3 text-sm text-surface disabled:opacity-50"
            >
              {busy
                ? "CANCELLING…"
                : action.reschedule
                  ? "Cancel and choose new time"
                  : "Yes, cancel"}
            </button>
            <button
              type="button"
              onClick={() => setAction(null)}
              disabled={busy}
              className="min-h-11 w-full rounded-xl border border-sage text-sm disabled:opacity-50"
            >
              Keep visit
            </button>
          </div>
        </ClinicalReviewDialog>
      )}
    </WorkspaceShell>
  );
}
