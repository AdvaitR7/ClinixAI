import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import type { SupabaseClient } from "@supabase/supabase-js";
import { db } from "../db.js";
import { contentHash } from "../prescriptions/routes.js";
import {
  consultationNotes,
  documents,
  encounters,
  labObservations,
  labReports,
  medicationRecords,
  prescriptionItems,
  prescriptions,
  prescriptionVersions,
} from "../schema.js";
import { MARKERS } from "./personas.js";

const BUCKET = "clinix-documents";
const FIXTURES = new URL("../../fixtures/", import.meta.url);

type Item = { medicine_name: string; strength: string; dose: string; route: string; frequency: string; timing: string; duration: string; instructions: string };
type Obs = { name: string; code: string; value: number; unit: string; low: number | null; high: number | null; flag: string | null };

/** Returns a Date `days` days before now, at 10:30 local time so history reads like clinic hours. */
function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(10, 30, 0, 0);
  return d;
}

/** Formats a date as YYYY-MM-DD for `date` columns. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Uploads a fixture to a private storage key and returns its size and sha256 for the documents row. */
async function uploadFixture(admin: SupabaseClient, key: string, fixture: string, mime: string) {
  const bytes = await readFile(new URL(fixture, FIXTURES));
  const { error } = await admin.storage.from(BUCKET).upload(key, bytes, { contentType: mime, upsert: true });
  if (error) throw error;
  return { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** True when the persona's marker encounter already exists, so history is never duplicated. */
async function hasMarker(patientId: string, concern: string): Promise<boolean> {
  const rows = await db!
    .select({ id: encounters.id })
    .from(encounters)
    .where(and(eq(encounters.patientId, patientId), eq(encounters.chiefConcern, concern)))
    .limit(1);
  return rows.length > 0;
}

type Visit = {
  daysAgo: number;
  concern: string;
  note: string;
  items: Item[];
  meds: { index: number; status: string; startedOn: number; endedOn: number | null; reason: string; adverse?: string; stopped?: string }[];
};

/**
 * Inserts one completed visit: encounter, final doctor note, a finalized prescription with an
 * immutable version 1, its items and the matching medication records.
 */
async function insertVisit(tx: Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0], patientId: string, doctorId: string, visit: Visit) {
  const started = daysAgo(visit.daysAgo);
  const closed = new Date(started.getTime() + 30 * 60 * 1000);
  const [encounter] = await tx
    .insert(encounters)
    .values({
      patientId,
      encounterType: "DOCTOR_IN_PERSON",
      status: "COMPLETED",
      chiefConcern: visit.concern,
      initiatedByActorType: "DOCTOR",
      initiatedByActorId: doctorId,
      relatedDoctorId: doctorId,
      startedAt: started,
      closedAt: closed,
    })
    .returning({ id: encounters.id });
  await tx.insert(consultationNotes).values({
    patientId,
    encounterId: encounter!.id,
    doctorId,
    noteType: "CONSULTATION",
    content: visit.note,
    isFinal: true,
    finalizedAt: closed,
    createdAt: started,
    updatedAt: closed,
  });
  if (visit.items.length === 0) return;
  const [rx] = await tx.insert(prescriptions).values({ patientId, encounterId: encounter!.id, doctorId, status: "ACTIVE", createdAt: closed }).returning({ id: prescriptions.id });
  const [version] = await tx
    .insert(prescriptionVersions)
    .values({ prescriptionId: rx!.id, versionNumber: 1, finalizedByDoctorId: doctorId, finalizedAt: closed, contentHash: contentHash(visit.items), createdAt: closed })
    .returning({ id: prescriptionVersions.id });
  await tx.update(prescriptions).set({ currentVersionId: version!.id }).where(eq(prescriptions.id, rx!.id));
  const rows = await tx
    .insert(prescriptionItems)
    .values(visit.items.map((it, i) => ({
      prescriptionVersionId: version!.id,
      sequenceNumber: i + 1,
      medicineName: it.medicine_name,
      strength: it.strength,
      dose: it.dose,
      route: it.route,
      frequency: it.frequency,
      timing: it.timing,
      duration: it.duration,
      instructions: it.instructions,
    })))
    .returning({ id: prescriptionItems.id, sequenceNumber: prescriptionItems.sequenceNumber });
  for (const med of visit.meds) {
    const item = visit.items[med.index]!;
    await tx.insert(medicationRecords).values({
      patientId,
      encounterId: encounter!.id,
      prescriptionId: rx!.id,
      prescriptionItemId: rows.find((r) => r.sequenceNumber === med.index + 1)?.id ?? null,
      medicineName: item.medicine_name,
      dose: `${item.strength} ${item.dose}`.trim(),
      route: item.route,
      frequency: item.frequency,
      startedOn: ymd(daysAgo(med.startedOn)),
      endedOn: med.endedOn === null ? null : ymd(daysAgo(med.endedOn)),
      reasonForUse: med.reason,
      adverseReaction: med.adverse ?? null,
      reasonStopped: med.stopped ?? null,
      status: med.status,
    });
  }
}

/** Inserts a COMPLETE lab report (document row plus observations) whose source file was already uploaded. */
async function insertLab(tx: Parameters<Parameters<NonNullable<typeof db>["transaction"]>[0]>[0], patientId: string, upload: { key: string; id: string; size: number; sha256: string; filename: string; mime: string; type: "LAB_REPORT" | "PRESCRIPTION" }, lab: { days: number; name: string; observations: Obs[] } | null) {
  await tx.insert(documents).values({
    id: upload.id,
    patientId,
    documentType: upload.type,
    storageBucket: BUCKET,
    storageObjectKey: upload.key,
    originalFilename: upload.filename,
    mimeType: upload.mime,
    fileSizeBytes: upload.size,
    sha256: upload.sha256,
    uploadedByActorType: "PATIENT",
    processingStatus: "COMPLETE",
    createdAt: lab ? daysAgo(lab.days) : daysAgo(96),
  });
  if (!lab) return;
  const observedAt = daysAgo(lab.days);
  const [report] = await tx
    .insert(labReports)
    .values({ patientId, documentId: upload.id, laboratoryName: lab.name, collectionDate: ymd(observedAt), reportDate: ymd(observedAt), createdAt: observedAt })
    .returning({ id: labReports.id });
  await tx.insert(labObservations).values(
    lab.observations.map((o) => ({
      labReportId: report!.id,
      patientId,
      testCode: o.code,
      testName: o.name,
      valueNumeric: String(o.value),
      unit: o.unit,
      referenceLow: o.low === null ? null : String(o.low),
      referenceHigh: o.high === null ? null : String(o.high),
      flag: o.flag,
      confidence: "0.98",
      observedAt,
      createdAt: observedAt,
    })),
  );
}

/** Persona A: previous cough encounter, an old amoxicillin course with a reaction, a lab PDF and the prescription photo. */
export async function seedPersonaA(admin: SupabaseClient, patientId: string, doctorId: string): Promise<boolean> {
  if (await hasMarker(patientId, MARKERS.a)) return false;
  const labId = randomUUID();
  const rxId = randomUUID();
  const labUpload = { id: labId, key: `${patientId}/${labId}`, filename: "lab_synthetic.pdf", mime: "application/pdf", type: "LAB_REPORT" as const, ...(await uploadFixture(admin, `${patientId}/${labId}`, "lab_synthetic.pdf", "application/pdf")) };
  const rxUpload = { id: rxId, key: `${patientId}/${rxId}`, filename: "rx_synthetic.png", mime: "image/png", type: "PRESCRIPTION" as const, ...(await uploadFixture(admin, `${patientId}/${rxId}`, "rx_synthetic.png", "image/png")) };
  await db!.transaction(async (tx) => {
    await insertVisit(tx, patientId, doctorId, {
      daysAgo: 96,
      concern: MARKERS.a,
      note: "Productive cough and low-grade fever for five days. Chest clear on auscultation. Started amoxicillin 500 mg three times daily for five days with paracetamol as needed. Follow-up note: patient developed a skin rash on day three and stopped amoxicillin; suspected amoxicillin allergy. Avoid penicillin-class antibiotics until reviewed.",
      items: [
        { medicine_name: "Amoxicillin", strength: "500 mg", dose: "1 capsule", route: "Oral", frequency: "Three times daily", timing: "After food", duration: "5 days", instructions: "Complete the course unless a reaction occurs." },
        { medicine_name: "Paracetamol", strength: "650 mg", dose: "1 tablet", route: "Oral", frequency: "As needed for fever", timing: "After food", duration: "3 days", instructions: "Maximum four tablets in 24 hours." },
      ],
      meds: [
        { index: 0, status: "DISCONTINUED", startedOn: 96, endedOn: 93, reason: "Respiratory infection", adverse: "Skin rash on day three; suspected amoxicillin allergy", stopped: "Rash" },
        { index: 1, status: "PAST", startedOn: 96, endedOn: 93, reason: "Fever" },
      ],
    });
    await insertLab(tx, patientId, labUpload, {
      days: 96,
      name: "Synthetic Diagnostics Lab",
      observations: [
        { name: "Hemoglobin", code: "HGB", value: 12.8, unit: "g/dL", low: 12, high: 15.5, flag: null },
        { name: "White blood cell count", code: "WBC", value: 11.8, unit: "10^3/uL", low: 4, high: 11, flag: "HIGH" },
        { name: "C-reactive protein", code: "CRP", value: 14, unit: "mg/L", low: 0, high: 5, flag: "HIGH" },
        { name: "Platelet count", code: "PLT", value: 262, unit: "10^3/uL", low: 150, high: 410, flag: null },
      ],
    });
    await insertLab(tx, patientId, rxUpload, null);
  });
  return true;
}

/** Persona B: five HbA1c results over about five months and a current metformin prescription. */
export async function seedPersonaB(admin: SupabaseClient, patientId: string, doctorId: string): Promise<boolean> {
  if (await hasMarker(patientId, MARKERS.b)) return false;
  const trend = [
    { days: 150, value: 8.4 },
    { days: 120, value: 8.0 },
    { days: 90, value: 7.7 },
    { days: 60, value: 7.3 },
    { days: 30, value: 7.0 },
  ];
  // Every lab report needs a source document; they share the synthetic lab fixture as their file.
  const uploads = await Promise.all(trend.map(async (t) => {
    const id = randomUUID();
    const key = `${patientId}/${id}`;
    return { t, upload: { id, key, filename: "lab_synthetic.pdf", mime: "application/pdf", type: "LAB_REPORT" as const, ...(await uploadFixture(admin, key, "lab_synthetic.pdf", "application/pdf")) } };
  }));
  await db!.transaction(async (tx) => {
    await insertVisit(tx, patientId, doctorId, {
      daysAgo: 150,
      concern: MARKERS.b,
      note: "Type 2 diabetes follow-up. Fasting symptoms absent. Started metformin 500 mg twice daily with meals; diet and activity advice given. Repeat HbA1c in 30 days.",
      items: [
        { medicine_name: "Metformin", strength: "500 mg", dose: "1 tablet", route: "Oral", frequency: "Twice daily", timing: "With meals", duration: "Ongoing", instructions: "Take with food." },
      ],
      meds: [{ index: 0, status: "CURRENT", startedOn: 150, endedOn: null, reason: "Type 2 diabetes" }],
    });
    for (const { t, upload } of uploads) {
      await insertLab(tx, patientId, upload, {
        days: t.days,
        name: "Synthetic Diagnostics Lab",
        observations: [{ name: "HbA1c", code: "HBA1C", value: t.value, unit: "%", low: 4, high: 5.6, flag: "HIGH" }],
      });
    }
  });
  return true;
}

/** Persona C: one routine visit with no findings; the red-flag check-in is scripted live. */
export async function seedPersonaC(patientId: string, doctorId: string): Promise<boolean> {
  if (await hasMarker(patientId, MARKERS.c)) return false;
  await db!.transaction(async (tx) => {
    await insertVisit(tx, patientId, doctorId, {
      daysAgo: 200,
      concern: MARKERS.c,
      note: "Routine health review. No active concerns. Advised annual review.",
      items: [],
      meds: [],
    });
  });
  return true;
}
