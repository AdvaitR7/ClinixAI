"use client";

import { useEffect } from "react";

const legacyRoutes: Array<[RegExp, string, string]> = [
  [/^\/app\/staff\/intake\/([^/]+)$/, "/app/staff/intake/by-id", "appointmentId"],
  [/^\/app\/staff\/receipt\/([^/]+)$/, "/app/staff/receipt/by-id", "appointmentId"],
  [/^\/app\/staff\/followups\/([^/]+)$/, "/app/staff/followups/by-id", "id"],
  [/^\/app\/doctor\/consultation\/([^/]+)$/, "/app/doctor/consultation/by-id", "appointmentId"],
  [/^\/app\/doctor\/followups\/([^/]+)$/, "/app/doctor/followups/by-id", "id"],
  [/^\/app\/doctor\/patients\/([^/]+)\/context$/, "/app/doctor/patients/by-id/context", "patientId"],
  [/^\/app\/doctor\/patients\/([^/]+)$/, "/app/doctor/patients/by-id", "patientId"],
  [/^\/app\/doctor\/prescriptions\/([^/]+)$/, "/app/doctor/prescriptions/by-id", "prescriptionId"],
  [/^\/app\/doctor\/prescription-drafts\/([^/]+)\/preview$/, "/app/doctor/prescription-drafts/by-id/preview", "draftId"],
  [/^\/app\/doctor\/prescription-drafts\/([^/]+)$/, "/app/doctor/prescription-drafts/by-id", "draftId"],
  [/^\/app\/doctor\/schedule\/([^/]+)$/, "/app/doctor/schedule/by-id", "appointmentId"],
  [/^\/app\/patient\/care\/share\/([^/]+)$/, "/app/patient/care/share/by-id", "doctorId"],
  [/^\/app\/patient\/checkin\/result\/([^/]+)$/, "/app/patient/checkin/result/by-id", "sessionId"],
  [/^\/app\/patient\/privacy\/access\/([^/]+)$/, "/app/patient/privacy/access/by-id", "eventId"],
  [/^\/app\/patient\/timeline\/checkins\/([^/]+)$/, "/app/patient/timeline/checkins/by-id", "sessionId"],
];

/** Sends old ID-in-path links to the bundled app's fixed query-parameter routes. */
export default function NotFound() {
  useEffect(() => {
    for (const [pattern, target, key] of legacyRoutes) {
      const match = window.location.pathname.match(pattern);
      if (!match) continue;
      const query = new URLSearchParams(window.location.search);
      query.set(key, decodeURIComponent(match[1]));
      window.location.replace(`${target}?${query.toString()}`);
      return;
    }
  }, []);

  return <main className="grid min-h-dvh place-items-center bg-canvas px-6 text-center text-ink"><p>This CliniX page could not be found.</p></main>;
}
