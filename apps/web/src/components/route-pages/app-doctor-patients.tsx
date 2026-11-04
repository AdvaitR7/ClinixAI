"use client";


import { useRouteParam } from "@/lib/route-params";


import { DoctorPatientRecord } from "@/components/doctor-patient-record";

/** SCR-029: source-backed clinical dossier (FigCraft frame 2789). */
export default function PatientWorkspacePage() {
  const patientId = useRouteParam("patientId");
  return <DoctorPatientRecord key={patientId} patientId={patientId} />;
}
