"use client";

import { useParams } from "next/navigation";
import { DoctorPatientRecord } from "@/components/doctor-patient-record";

/** SCR-029: source-backed clinical dossier (FigCraft frame 2789). */
export default function PatientWorkspacePage() {
  const { patientId } = useParams<{ patientId: string }>();
  return <DoctorPatientRecord key={patientId} patientId={patientId} />;
}
