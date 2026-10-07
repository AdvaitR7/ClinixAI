import { desc, eq } from "drizzle-orm";
import type { MedicationView } from "@clinix/schemas";
import { requireDb } from "../http.js";
import {
  doctors,
  medicationRecords,
  prescriptionItems,
  prescriptionVersions,
  prescriptions,
  profiles,
} from "../schema.js";

/**
 * Medication history for a patient (API §27). Two sources:
 *  - `medication_records` (explicit exposure history — no write path yet);
 *  - finalized prescription items, derived as UNKNOWN_STATUS.
 * A historical prescription is NEVER auto-labelled CURRENT (spec safety rule):
 * the doctor prescribed it, but we do not know the patient is still taking it.
 */
export async function medicationsForPatient(patientId: string): Promise<MedicationView[]> {
  const database = requireDb();

  const [records, rxRows] = await Promise.all([
    database
      .select()
      .from(medicationRecords)
      .where(eq(medicationRecords.patientId, patientId))
      .orderBy(desc(medicationRecords.createdAt)),
    database
      .select({
        prescriptionId: prescriptions.id,
        encounterId: prescriptions.encounterId,
        finalizedAt: prescriptionVersions.finalizedAt,
        doctorName: profiles.displayName,
        medicineName: prescriptionItems.medicineName,
        dose: prescriptionItems.dose,
        route: prescriptionItems.route,
        frequency: prescriptionItems.frequency,
      })
      .from(prescriptions)
      .innerJoin(
        prescriptionVersions,
        eq(prescriptionVersions.id, prescriptions.currentVersionId),
      )
      .innerJoin(doctors, eq(doctors.id, prescriptions.doctorId))
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .innerJoin(
        prescriptionItems,
        eq(prescriptionItems.prescriptionVersionId, prescriptionVersions.id),
      )
      .where(eq(prescriptions.patientId, patientId))
      .orderBy(desc(prescriptionVersions.finalizedAt)),
  ]);

  const fromRecords: MedicationView[] = records.map((r) => ({
    medicine_name: r.medicineName,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    status: normalizeStatus(r.status),
    prescribing_doctor: null,
    prescribed_date: r.createdAt.toISOString(),
    encounter_id: r.encounterId,
    prescription_id: r.prescriptionId,
    response: r.response,
    adverse_reaction: r.adverseReaction,
    reason_stopped: r.reasonStopped,
  }));

  const fromPrescriptions: MedicationView[] = rxRows.map((r) => ({
    medicine_name: r.medicineName,
    dose: r.dose,
    route: r.route,
    frequency: r.frequency,
    status: "UNKNOWN_STATUS",
    prescribing_doctor: r.doctorName,
    prescribed_date: r.finalizedAt.toISOString(),
    encounter_id: r.encounterId,
    prescription_id: r.prescriptionId,
    response: null,
    adverse_reaction: null,
    reason_stopped: null,
  }));

  return [...fromRecords, ...fromPrescriptions];
}

function normalizeStatus(raw: string): "CURRENT" | "PAST" | "UNKNOWN_STATUS" {
  const s = raw.toUpperCase();
  return s === "CURRENT" || s === "PAST" || s === "UNKNOWN_STATUS" ? s : "UNKNOWN_STATUS";
}
