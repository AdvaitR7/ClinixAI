"use client";

import { useParams } from "next/navigation";
import { DoctorPatientRecord } from "@/components/doctor-patient-record";

/** SCR-028: compact patient context before entering the full record or a consultation. */
export default function PatientContextPage() {
  const { patientId } = useParams<{ patientId: string }>();
  return <DoctorPatientRecord key={patientId} patientId={patientId} compact />;
}
