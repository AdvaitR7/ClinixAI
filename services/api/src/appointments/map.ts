import { inArray } from "drizzle-orm";
import { decryptIdentity } from "../crypto.js";
import { requireDb } from "../http.js";
import { appointments, patientIdentity } from "../schema.js";

type AppointmentRow = typeof appointments.$inferSelect;

export function appointmentView(row: AppointmentRow, patientName: string) {
  return {
    id: row.id,
    patient_id: row.patientId,
    doctor_id: row.doctorId,
    appointment_type: row.appointmentType,
    status: row.status,
    scheduled_start: row.scheduledStart.toISOString(),
    scheduled_end: row.scheduledEnd ? row.scheduledEnd.toISOString() : null,
    reason: row.reason,
    payment_status: row.paymentStatus,
    patient_name: patientName,
  };
}

/** Batch-decrypt patient names for a set of patient ids (prototype scale). */
export async function patientNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const database = requireDb();
  const rows = await database
    .select({
      patientId: patientIdentity.patientId,
      fullNameEncrypted: patientIdentity.fullNameEncrypted,
    })
    .from(patientIdentity)
    .where(inArray(patientIdentity.patientId, ids));
  return new Map(
    rows.map((r) => [r.patientId, decryptIdentity(r.fullNameEncrypted)]),
  );
}
