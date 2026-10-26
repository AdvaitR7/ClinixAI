import { and, desc, eq, inArray } from "drizzle-orm";
import type { MedicationView } from "@clinix/schemas";
import { requireDb } from "../http.js";
import {
  doctors,
  encounters,
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
 * An optional doctor ID limits both sources to that doctor's own records.
 */
export async function medicationsForPatient(patientId: string, doctorId?: string): Promise<MedicationView[]> {
  const database = requireDb();

  /** Reads exact authored items; linked historical items retain their own immutable version. */
  function prescriptionRows(itemIds?: string[]) {
    return database.select({
      itemId: prescriptionItems.id,
      prescriptionId: prescriptions.id,
      encounterId: prescriptions.encounterId,
      versionNumber: prescriptionVersions.versionNumber,
      finalizedAt: prescriptionVersions.finalizedAt,
      doctorName: profiles.displayName,
      medicineName: prescriptionItems.medicineName,
      strength: prescriptionItems.strength,
      dose: prescriptionItems.dose,
      route: prescriptionItems.route,
      frequency: prescriptionItems.frequency,
      duration: prescriptionItems.duration,
      timing: prescriptionItems.timing,
      instructions: prescriptionItems.instructions,
    }).from(prescriptions)
      .innerJoin(prescriptionVersions, eq(prescriptionVersions.prescriptionId, prescriptions.id))
      .innerJoin(doctors, eq(doctors.id, prescriptionVersions.finalizedByDoctorId))
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .innerJoin(prescriptionItems, eq(prescriptionItems.prescriptionVersionId, prescriptionVersions.id))
      .where(and(
        eq(prescriptions.patientId, patientId),
        doctorId ? eq(prescriptions.doctorId, doctorId) : undefined,
        itemIds ? inArray(prescriptionItems.id, itemIds) : eq(prescriptionVersions.id, prescriptions.currentVersionId),
      )).orderBy(desc(prescriptionVersions.finalizedAt));
  }
  const [records, rxRows] = await Promise.all([
    database.select().from(medicationRecords).where(and(
      eq(medicationRecords.patientId, patientId),
      doctorId ? inArray(medicationRecords.encounterId, database.select({ id: encounters.id }).from(encounters).where(and(eq(encounters.relatedDoctorId, doctorId), eq(encounters.patientId, patientId)))) : undefined,
    )).orderBy(desc(medicationRecords.createdAt)),
    prescriptionRows(),
  ]);
  const linkedIds = records.flatMap((record) => record.prescriptionItemId ? [record.prescriptionItemId] : []);
  const linked = linkedIds.length ? await prescriptionRows(linkedIds) : [];

  const fromRecords: MedicationView[] = records.map((r) => {
    // Names are not identifiers: never attach another item/version merely because its name matches.
    const source = linked.find((item) => item.itemId === r.prescriptionItemId && item.prescriptionId === r.prescriptionId);
    return {
      entry_id: `exposure:${r.id}`,
      source_kind: "RECORDED_EXPOSURE",
      strength: source?.strength ?? null,
      duration: source?.duration ?? null,
      timing: source?.timing ?? null,
      instructions: source?.instructions ?? null,
      started_on: r.startedOn,
      ended_on: r.endedOn,
      reason_for_use: r.reasonForUse,
      recorded_at: r.createdAt.toISOString(),
      prescription_version_number: source?.versionNumber ?? null,
      medicine_name: r.medicineName,
      dose: r.dose,
      route: r.route,
      frequency: r.frequency,
      status: normalizeStatus(r.status),
      prescribing_doctor: source?.doctorName ?? null,
      prescribed_date: source?.finalizedAt.toISOString() ?? null,
      encounter_id: r.encounterId,
      prescription_id: r.prescriptionId,
      response: r.response,
      adverse_reaction: r.adverseReaction,
      reason_stopped: r.reasonStopped,
    };
  });

  const fromPrescriptions: MedicationView[] = rxRows.map((r) => ({
    entry_id: `prescription:${r.itemId}`,
    source_kind: "PRESCRIPTION",
    strength: r.strength,
    duration: r.duration,
    timing: r.timing,
    instructions: r.instructions,
    started_on: null,
    ended_on: null,
    reason_for_use: null,
    recorded_at: null,
    prescription_version_number: r.versionNumber,
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

/** Preserves only explicitly recorded status; dates and prescription status never prove current use. */
function normalizeStatus(raw: string): MedicationView["status"] {
  const s = raw.toUpperCase();
  return s === "CURRENT" || s === "PAST" || s === "DISCONTINUED" || s === "UNKNOWN_STATUS" ? s : "UNKNOWN_STATUS";
}
