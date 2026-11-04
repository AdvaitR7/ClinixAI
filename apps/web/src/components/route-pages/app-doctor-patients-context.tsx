"use client";


import { useRouteParam } from "@/lib/route-params";


import { DoctorPatientRecord } from "@/components/doctor-patient-record";

/** SCR-028: compact patient context before entering the full record or a consultation. */
export default function PatientContextPage() {
  const patientId = useRouteParam("patientId");
  return <DoctorPatientRecord key={patientId} patientId={patientId} compact />;
}
