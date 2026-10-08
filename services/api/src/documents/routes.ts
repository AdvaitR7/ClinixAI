import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import {
  needsReviewByConfidence,
  patchObservationSchema,
  uploadInitSchema,
  type DocumentView,
  type LabObservationView,
  type LabReportView,
} from "@clinix/schemas";
import { authorizePatientAccess, requireDoctor, requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import { logAccess } from "../audit/log.js";
import { sendDocumentExtract } from "../queue.js";
import {
  documents,
  labObservations,
  labReports,
  type documents as _documents,
  type labObservations as _labObservations,
} from "../schema.js";
import { downloadObject, signedUploadUrl, signedViewUrl } from "../storage.js";

const BUCKET = "clinix-documents";

type DocumentRow = typeof _documents.$inferSelect;
type ObservationRow = typeof _labObservations.$inferSelect;

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

function documentView(row: DocumentRow, viewUrl: string | null = null): DocumentView {
  return {
    document_id: row.id,
    document_type: row.documentType,
    original_filename: row.originalFilename,
    mime_type: row.mimeType,
    file_size_bytes: row.fileSizeBytes ?? null,
    processing_status: row.processingStatus,
    created_at: row.createdAt.toISOString(),
    view_url: viewUrl,
  };
}

function observationView(row: ObservationRow): LabObservationView {
  const confidence = num(row.confidence);
  return {
    id: row.id,
    test_name: row.testName,
    test_code: row.testCode,
    value_numeric: num(row.valueNumeric),
    value_text: row.valueText,
    unit: row.unit,
    reference_low: num(row.referenceLow),
    reference_high: num(row.referenceHigh),
    reference_text: row.referenceText,
    flag: row.flag,
    observed_at: row.observedAt ? row.observedAt.toISOString() : null,
    confidence,
    needs_review: needsReviewByConfidence(confidence),
    confirmed_at: row.confirmedAt ? row.confirmedAt.toISOString() : null,
  };
}

/** Loads one lab report with its observations, ordered by test name. */
async function loadReportView(reportId: string): Promise<LabReportView | null> {
  const database = requireDb();
  const [report] = await database
    .select()
    .from(labReports)
    .where(eq(labReports.id, reportId))
    .limit(1);
  if (!report) return null;
  const obs = await database
    .select()
    .from(labObservations)
    .where(eq(labObservations.labReportId, reportId))
    .orderBy(asc(labObservations.testName));
  return {
    report_id: report.id,
    laboratory_name: report.laboratoryName,
    collection_date: report.collectionDate,
    report_date: report.reportDate,
    source_document_id: report.documentId,
    created_at: report.createdAt.toISOString(),
    observations: obs.map(observationView),
  };
}

/** Shared upload-init: inserts the documents row and mints a signed upload URL. */
async function uploadInit(
  request: Parameters<typeof requirePatient>[0],
  reply: Parameters<typeof requirePatient>[1],
  patientId: string,
  actorType: "PATIENT" | "DOCTOR",
  actorId: string,
) {
  const parsed = uploadInitSchema.safeParse(request.body);
  if (!parsed.success) {
    return error(request, reply, 400, "VALIDATION_ERROR", "Invalid upload payload");
  }
  const body = parsed.data;

  const database = requireDb();
  const id = randomUUID();
  // key = patientId/documentId — no filename in the path (filenames can carry PII).
  const key = `${patientId}/${id}`;
  await database.insert(documents).values({
    id,
    patientId,
    encounterId: body.encounter_id ?? null,
    documentType: body.document_type,
    storageBucket: BUCKET,
    storageObjectKey: key,
    originalFilename: body.filename,
    mimeType: body.mime_type,
    uploadedByActorType: actorType,
    uploadedByActorId: actorId,
    processingStatus: "UPLOADED",
  });

  const signed = await signedUploadUrl(key);
  await logAccess(request, {
    patientId,
    purpose: "Document upload initiated",
    resourceType: "DOCUMENT",
    resourceId: id,
    action: "UPLOAD_INIT",
  });
  return reply.code(201).send({
    document_id: id,
    upload_url: signed.uploadUrl,
    token: signed.token,
    path: signed.path,
    expires_in: 7200,
  });
}

/** Shared upload-complete: validates the object, hashes it, and enqueues extraction. */
async function uploadComplete(
  request: Parameters<typeof requirePatient>[0],
  reply: Parameters<typeof requirePatient>[1],
  patientId: string,
  documentId: string,
) {
  const database = requireDb();
  const [doc] = await database
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc || doc.patientId !== patientId || doc.deletedAt) {
    return error(request, reply, 404, "NOT_FOUND", "Document not found");
  }

  let bytes: Buffer;
  try {
    bytes = await downloadObject(doc.storageObjectKey);
  } catch {
    return error(request, reply, 404, "NOT_FOUND", "Stored object not found");
  }

  await database
    .update(documents)
    .set({
      fileSizeBytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      processingStatus: "PROCESSING",
    })
    .where(eq(documents.id, documentId));

  await logAccess(request, {
    patientId,
    purpose: "Document upload completed",
    resourceType: "DOCUMENT",
    resourceId: documentId,
    action: "UPLOAD_COMPLETE",
  });

  try {
    await sendDocumentExtract(documentId);
  } catch {
    await database
      .update(documents)
      .set({ processingStatus: "FAILED" })
      .where(eq(documents.id, documentId));
    return error(request, reply, 503, "QUEUE_UNAVAILABLE", "Document processing queue is unavailable");
  }
  return { ok: true, document_id: documentId };
}

/**
 * Documents & OCR (API §11–12 + documented doctor extensions). OCR output is
 * always draft-first (NEEDS_REVIEW); this module never finalizes anything.
 */
export async function documentRoutes(app: FastifyInstance) {
  // --- Patient document upload / shelf ---

  app.post("/patients/self/documents/upload-init", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    return uploadInit(request, reply, patientId, "PATIENT", patientId);
  });

  app.post<{ Params: { document_id: string } }>(
    "/patients/self/documents/:document_id/upload-complete",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;
      return uploadComplete(request, reply, patientId, request.params.document_id);
    },
  );

  app.get("/patients/self/documents", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const database = requireDb();
    const rows = await database
      .select()
      .from(documents)
      .where(and(eq(documents.patientId, patientId)))
      .orderBy(desc(documents.createdAt));
    return rows.map((r) => documentView(r));
  });

  app.get<{ Params: { document_id: string } }>(
    "/patients/self/documents/:document_id",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;

      const database = requireDb();
      const [doc] = await database
        .select()
        .from(documents)
        .where(eq(documents.id, request.params.document_id))
        .limit(1);
      if (!doc || doc.patientId !== patientId || doc.deletedAt) {
        return error(request, reply, 404, "NOT_FOUND", "Document not found");
      }
      const viewUrl = await signedViewUrl(doc.storageObjectKey);
      await logAccess(request, {
        patientId,
        purpose: "Patient viewed source document",
        resourceType: "DOCUMENT",
        resourceId: doc.id,
        action: "VIEW",
      });
      return documentView(doc, viewUrl);
    },
  );

  // --- Patient lab reports / observations ---

  app.get("/patients/self/lab-reports", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const database = requireDb();
    const reports = await database
      .select()
      .from(labReports)
      .where(eq(labReports.patientId, patientId))
      .orderBy(desc(labReports.createdAt));
    const views: LabReportView[] = [];
    for (const r of reports) {
      const v = await loadReportView(r.id);
      if (v) views.push(v);
    }
    return views;
  });

  app.get<{ Params: { report_id: string } }>(
    "/patients/self/lab-reports/:report_id",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;

      const view = await loadReportView(request.params.report_id);
      if (!view || !(await ownReport(patientId, request.params.report_id))) {
        return error(request, reply, 404, "NOT_FOUND", "Lab report not found");
      }
      return view;
    },
  );

  app.get("/patients/self/lab-observations", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const testName = (request.query as { test_name?: string }).test_name;
    if (!testName) {
      return error(request, reply, 400, "VALIDATION_ERROR", "test_name query param is required");
    }

    const database = requireDb();
    const rows = await database
      .select({
        observedAt: labObservations.observedAt,
        valueNumeric: labObservations.valueNumeric,
        reportId: labObservations.labReportId,
        confidence: labObservations.confidence,
      })
      .from(labObservations)
      .where(
        and(
          eq(labObservations.patientId, patientId),
          eq(labObservations.testName, testName),
          isNotNull(labObservations.valueNumeric),
        ),
      )
      .orderBy(asc(labObservations.observedAt));

    return {
      test_name: testName,
      points: rows
        .map((r) => ({
          observed_at: r.observedAt ? r.observedAt.toISOString() : "",
          value_numeric: num(r.valueNumeric)!,
          report_id: r.reportId,
          confidence: num(r.confidence),
        }))
        .filter((p) => p.observed_at),
    };
  });

  app.patch<{ Params: { id: string } }>(
    "/patients/self/lab-observations/:id",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;

      const parsed = patchObservationSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid observation payload");
      }
      const body = parsed.data;

      const database = requireDb();
      const [obs] = await database
        .select()
        .from(labObservations)
        .where(eq(labObservations.id, request.params.id))
        .limit(1);
      if (!obs || obs.patientId !== patientId) {
        return error(request, reply, 404, "NOT_FOUND", "Observation not found");
      }

      const set: Partial<typeof obs> = {};
      if (body.value_numeric !== undefined) set.valueNumeric = body.value_numeric?.toString() ?? null;
      if (body.value_text !== undefined) set.valueText = body.value_text;
      if (body.unit !== undefined) set.unit = body.unit;
      if (body.confirmed) {
        set.confirmedAt = new Date();
        set.confirmedByProfileId = request.auth.profileId;
      }

      const [updated] = await database
        .update(labObservations)
        .set(set)
        .where(eq(labObservations.id, request.params.id))
        .returning();

      await logAccess(request, {
        patientId,
        purpose: body.confirmed ? "Patient confirmed lab value" : "Patient corrected lab value",
        resourceType: "LAB_REPORT",
        resourceId: obs.labReportId,
        action: body.confirmed ? "CONFIRM" : "CORRECT",
      });
      return observationView(updated);
    },
  );

  // --- Doctor document upload (contract extension; feeds P20 side-by-side) ---

  app.post<{ Params: { patient_id: string } }>(
    "/doctor/patients/:patient_id/documents/upload-init",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;
      if (!(await authorizePatientAccess(request.auth, request.params.patient_id))) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient");
      }
      return uploadInit(request, reply, request.params.patient_id, "DOCTOR", doctorId);
    },
  );

  app.post<{ Params: { patient_id: string; document_id: string } }>(
    "/doctor/patients/:patient_id/documents/:document_id/upload-complete",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;
      if (!(await authorizePatientAccess(request.auth, request.params.patient_id))) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient");
      }
      return uploadComplete(request, reply, request.params.patient_id, request.params.document_id);
    },
  );

  app.get<{ Params: { document_id: string } }>(
    "/doctor/documents/:document_id",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const database = requireDb();
      const [doc] = await database
        .select()
        .from(documents)
        .where(eq(documents.id, request.params.document_id))
        .limit(1);
      if (!doc || doc.deletedAt) {
        return error(request, reply, 404, "NOT_FOUND", "Document not found");
      }
      if (!(await authorizePatientAccess(request.auth, doc.patientId))) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this document");
      }
      const viewUrl = await signedViewUrl(doc.storageObjectKey);
      await logAccess(request, {
        patientId: doc.patientId,
        purpose: "Doctor viewed source document",
        resourceType: "DOCUMENT",
        resourceId: doc.id,
        action: "VIEW",
      });
      return documentView(doc, viewUrl);
    },
  );
}

/** Ownership check for a lab report (avoids leaking other patients' reports). */
async function ownReport(patientId: string, reportId: string): Promise<boolean> {
  const database = requireDb();
  const [r] = await database
    .select({ patientId: labReports.patientId })
    .from(labReports)
    .where(eq(labReports.id, reportId))
    .limit(1);
  return r?.patientId === patientId;
}
