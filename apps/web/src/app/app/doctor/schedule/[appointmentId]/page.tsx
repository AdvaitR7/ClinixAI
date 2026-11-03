"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { AppointmentView, DoctorWorkspace } from "@clinix/schemas";
import { useApiData } from "@/lib/api";
import { ClinixBrand } from "@/components/clinix-brand";
import { readScheduleState, scheduleCard, scheduleHref, scheduleTime } from "@/lib/doctor-schedule";

/** Supplies the omitted appointment context under the existing doctor authorization layout. */
export default function AppointmentContextPage() {
  return <Suspense fallback={<p role="status" className="p-6">Loading appointment context…</p>}><SelectedContext /></Suspense>;
}

/** Selects an owned appointment without using the consultation GET that creates an encounter. */
function SelectedContext() {
  const { appointmentId } = useParams<{ appointmentId: string }>();
  const query = useSearchParams();
  const back = scheduleHref({ ...readScheduleState(query), tab: "schedule" });
  const appointments = useApiData<AppointmentView[]>("/doctor/appointments");
  const appointment = appointments.status === "ready" ? appointments.data.find((row) => row.id === appointmentId) : null;
  return <main className="min-h-dvh bg-ink px-6 py-6 text-surface"><div className="mx-auto max-w-[345px]">
    <header className="flex items-center justify-between gap-3 [&>span>span:last-child]:text-2xl [&>span>span:last-child]:font-normal"><Link href={back} aria-label="Back to schedule" className="grid size-11 place-items-center text-[29px] text-copper">←</Link><ClinixBrand inverted monogram /><Link href={back} className="min-h-11 py-3 text-xs text-evidence">Close</Link></header>
    {appointments.status === "loading" && <p role="status" className="mt-8 text-sm">Loading appointment context…</p>}
    {appointments.status === "error" && <div role="alert" className={`${scheduleCard} mt-8`}><p className="text-sm">{appointments.error}</p><button type="button" onClick={() => void appointments.refresh()} className="min-h-11 text-xs text-evidence">Retry context</button></div>}
    {appointments.status === "ready" && !appointment && <p role="alert" className={`${scheduleCard} mt-8 text-sm`}>This appointment is unavailable in your schedule.</p>}
    {appointment && <AppointmentContext key={appointment.id} appointment={appointment} />}
  </div></main>;
}

/** Shows source-backed visit data and honest limits until scoped clinical packet services exist. */
function AppointmentContext({ appointment }: { appointment: AppointmentView }) {
  const workspace = useApiData<DoctorWorkspace>(`/doctor/patients/${encodeURIComponent(appointment.patient_id)}/workspace`);
  const record = workspace.status === "ready" ? workspace.data : null;
  const current = record?.medications?.filter((item) => item.status === "CURRENT") ?? [];
  return <div className="space-y-8">
    <div><p className="mt-5 w-fit rounded-full border border-copper bg-[#3d4640] px-5 py-2 text-[9px]">APPOINTMENT CONTEXT</p><h1 className="mt-5 break-words text-[30px] leading-tight">{appointment.patient_name || "Patient name unavailable"}</h1><p className="mt-2 text-xs">{appointment.reason || "Visit reason not recorded"} · {appointment.appointment_type === "ONLINE" ? "Online consultation" : "In-clinic"}</p></div>
    <section className={scheduleCard}><p className="text-[9px] text-copper">{new Date(appointment.scheduled_start).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" })} · {scheduleTime(appointment.scheduled_start)}</p><h2 className="mt-3 text-sm">{appointment.appointment_type === "ONLINE" ? "Online consultation" : "In-clinic consultation"}</h2><dl className="mt-4 flex flex-wrap gap-x-6 gap-y-3 text-[8px]"><div className="flex items-center gap-2"><dt>PAYMENT</dt><dd className="rounded-full bg-botanical px-4 py-2 text-[9px]">{appointment.payment_status}</dd></div><div className="flex items-center gap-2"><dt>CONSULTATION</dt><dd className="rounded-full bg-evidence px-4 py-2 text-[9px] text-ink">{appointment.status}</dd></div></dl>{appointment.appointment_type === "ONLINE" && <p className="mt-4 text-[10px]">Video joining and waiting-room status are unavailable.</p>}</section>
    <section><h2 className="mb-3 text-[10px] text-copper">CONSULTATION PACKET</h2><div className={scheduleCard}><p className="text-base">Scoped records unavailable</p><ul className="mt-4 divide-y divide-copper/60">{["AI check-in result", "Original lab source", "Shared active medications"].map((label) => <li key={label} className="flex items-center justify-between gap-3 py-3"><span className="text-xs">{label}</span><button type="button" disabled className="min-h-9 text-[9px] text-evidence/50">Open →<span className="sr-only"> {label} unavailable</span></button></li>)}</ul><p className="mt-3 text-[9px] leading-4">This appointment does not supply a verified packet, recipient scope or expiry. No patient-shared records have been opened.</p></div></section>
    <section><h2 className="mb-3 text-[10px] text-copper">CLINICAL SNAPSHOT</h2><div className={scheduleCard}><p className="text-[8px]">VISIT REASON</p><p className="mt-3 break-words text-xs">{appointment.reason || "Not recorded"}</p><dl className="mt-4 grid grid-cols-2 gap-4 border-t border-copper/60 pt-3 text-[8px]"><div><dt>KNOWN ALLERGIES</dt><dd className="mt-2 text-xs">Allergy data unavailable</dd></div><div><dt>YOUR CURRENT-USE RECORDS</dt><dd className="mt-2 text-xs">{record && current.length ? `${current.length} explicitly recorded` : "Unavailable / not established"}</dd></div></dl><p className="mt-4 text-[9px]">Clinical record access is limited to your own authorized records.</p>
      {workspace.status === "loading" && <p role="status" className="mt-3 text-xs">Checking patient-record access…</p>}
      {workspace.status === "error" && <div role="alert" className="mt-4 text-xs"><p>{workspace.error}</p><button type="button" onClick={() => void workspace.refresh()} className="min-h-11 text-evidence">Retry patient record access</button></div>}
    </div></section>
    <p className={`${scheduleCard} border-evidence text-[10px] leading-4`}>Opening this context does not create an encounter or change the patient record.</p>
    <div className="space-y-4">{appointment.status === "CONFIRMED" ? <Link href={`/app/doctor/consultation/${encodeURIComponent(appointment.id)}`} className="flex min-h-14 items-center justify-between rounded-[20px] bg-copper px-5 text-[13px] text-ink">START CONSULTATION <span aria-hidden="true">→</span></Link> : <button type="button" disabled className="min-h-14 w-full rounded-[20px] bg-copper px-4 text-xs text-ink opacity-50">Consultation cannot start while {appointment.status.toLowerCase()}</button>}
      {record ? <Link href={`/app/doctor/patients/${encodeURIComponent(appointment.patient_id)}`} className="flex min-h-14 items-center justify-center rounded-[20px] border border-copper bg-[#3d4640] px-4 text-xs">OPEN PATIENT RECORD</Link> : <button type="button" disabled className="min-h-14 w-full rounded-[20px] border border-copper px-4 text-xs opacity-50">Patient record access unavailable</button>}
    </div><p className="pb-8 text-center text-[9px] text-doctor-muted/70">Authorized record reads use the existing access audit. Scoped sharing remains unavailable.</p>
  </div>;
}
