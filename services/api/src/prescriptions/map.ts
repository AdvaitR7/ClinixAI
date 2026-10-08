import type {
  PrescriptionDraftItemView,
  PrescriptionDraftView,
  PrescriptionItemView,
  PrescriptionVersionView,
  PrescriptionView,
} from "@clinix/schemas";
import type {
  prescriptionDraftItems as _draftItems,
  prescriptionDrafts as _drafts,
  prescriptionItems as _items,
  prescriptionVersions as _versions,
} from "../schema.js";

type DraftRow = typeof _drafts.$inferSelect;
type DraftItemRow = typeof _draftItems.$inferSelect;
type ItemRow = typeof _items.$inferSelect;
type VersionRow = typeof _versions.$inferSelect;

export function draftItemView(row: DraftItemRow): PrescriptionDraftItemView {
  return {
    id: row.id,
    sequence_number: row.sequenceNumber,
    medicine_name: row.medicineName,
    strength: row.strength ?? undefined,
    dose: row.dose ?? undefined,
    route: row.route ?? undefined,
    frequency: row.frequency ?? undefined,
    timing: row.timing ?? undefined,
    duration: row.duration ?? undefined,
    instructions: row.instructions ?? undefined,
    needs_review: row.needsReview,
    field_confidence: row.fieldConfidence,
  };
}

export function draftView(
  row: DraftRow,
  patientName: string,
  items: DraftItemRow[],
): PrescriptionDraftView {
  return {
    id: row.id,
    patient_id: row.patientId,
    encounter_id: row.encounterId,
    doctor_id: row.doctorId,
    source: row.source,
    status: row.status,
    patient_name: patientName,
    created_at: row.createdAt.toISOString(),
    overall_confidence: row.overallConfidence ? Number(row.overallConfidence) : null,
    risk_flags: row.riskFlags,
    source_document_id: row.sourceDocumentId,
    items: items.map(draftItemView),
  };
}

export function itemView(row: ItemRow): PrescriptionItemView {
  return {
    medicine_name: row.medicineName,
    medicine_code: row.medicineCode,
    strength: row.strength,
    dose: row.dose,
    route: row.route,
    frequency: row.frequency,
    timing: row.timing,
    duration: row.duration,
    instructions: row.instructions,
  };
}

export function versionView(
  version: VersionRow,
  items: ItemRow[],
  finalizerName: string,
): PrescriptionVersionView {
  return {
    version_number: version.versionNumber,
    finalized_by: finalizerName,
    finalized_at: version.finalizedAt.toISOString(),
    amendment_reason: version.amendmentReason,
    items: items.map(itemView),
  };
}

export function buildPrescriptionView(input: {
  id: string;
  patientId: string;
  doctorId: string;
  status: string;
  createdAt: Date;
  currentVersionNumber: number | null;
  versions: PrescriptionVersionView[];
}): PrescriptionView {
  const current = input.versions.find(
    (v) => v.version_number === input.currentVersionNumber,
  );
  return {
    id: input.id,
    patient_id: input.patientId,
    doctor_id: input.doctorId,
    status: input.status as PrescriptionView["status"],
    created_at: input.createdAt.toISOString(),
    current_version: current ?? input.versions[input.versions.length - 1],
    versions: input.versions,
  };
}
