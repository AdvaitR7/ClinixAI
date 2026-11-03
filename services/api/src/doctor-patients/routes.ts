import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, isNull, max, or, type SQL } from "drizzle-orm";
import { doctorCreatePatientSchema } from "@clinix/schemas";
import { authorizePatientAccess, requireDoctor } from "../auth/guards.js";
import { hashIdentity } from "../crypto.js";
import { createPatientFailure, createUnclaimedPatient } from "../patients/create.js";
import { logAccess } from "../audit/log.js";
import { error, requireDb } from "../http.js";
import { decryptMinimal } from "../patients/identity.js";
import {
  appointments,
  encounters,
  documents,
  labReports,
  prescriptions,
  prescriptionVersions,
  patientDoctorRelationships,
  patientIdentity,
  patients,
} from "../schema.js";
import { appointmentView } from "../appointments/map.js";
import { medicationsForPatient } from "../medications/derive.js";
import { loadReportView } from "../documents/routes.js";
import { activeConsentsForDoctor, consentCovering, lockedSections, scopeCovers } from "../privacy/consent.js";

const PHONE_RE = /^\+?\d[\d\s()-]*$/;

/** POST /doctor/patients — create unclaimed patient + relationship (API spec §5). */
export async function doctorPatientRoutes(app: FastifyInstance) {
  app.post("/doctor/patients", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const parsed = doctorCreatePatientSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid patient payload");
    }
    const created = await createUnclaimedPatient({
      body: parsed.data,
      doctorId,
      createdBy: { actorType: "DOCTOR", actorId: doctorId },
    });
    if (!created.ok) return createPatientFailure(request, reply, created.code);
    const patientId = created.patientId;

    return reply.code(201).send({ patient_id: patientId });
  });

  app.get("/doctor/patients", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const { q, filter } = request.query as { q?: string; filter?: string };
    const database = requireDb();

    const rows = await database
      .select({
        patientId: patients.id,
        patientStatus: patients.status,
        relationshipStatus: patientDoctorRelationships.status,
        identity: patientIdentity,
      })
      .from(patients)
      .innerJoin(
        patientDoctorRelationships,
        eq(patientDoctorRelationships.patientId, patients.id),
      )
      .leftJoin(patientIdentity, eq(patientIdentity.patientId, patients.id))
      .where(
        and(
          eq(patientDoctorRelationships.doctorId, doctorId),
          eq(patientDoctorRelationships.status, "ACTIVE"),
        ),
      );

    const scoped = rows.filter((r) =>
      filter === "unclaimed" ? r.patientStatus === "UNCLAIMED" : true,
    );

    // Search: phone-like q matches phone_hash (no decrypt); name q batch-decrypts.
    let matched = scoped;
    if (q && q.trim()) {
      const needle = q.trim();
      if (PHONE_RE.test(needle)) {
        const h = hashIdentity(needle);
        matched = scoped.filter((r) => r.identity?.phoneHash === h);
      } else {
        const lower = needle.toLowerCase();
        matched = scoped.filter((r) => {
          if (!r.identity) return false;
          return decryptMinimal(r.identity).full_name.toLowerCase().includes(lower) || r.patientId.toLowerCase().includes(lower);
        });
      }
    }

    const ids = matched.map((r) => r.patientId);
    const lastEncounters =
      ids.length === 0
        ? []
        : await database
            .select({
              patientId: encounters.patientId,
              lastAt: max(encounters.startedAt),
            })
            .from(encounters)
            .where(and(inArray(encounters.patientId, ids), eq(encounters.relatedDoctorId, doctorId)))
            .groupBy(encounters.patientId);
    const lastByPatient = new Map(
      lastEncounters.map((e) => [
        e.patientId,
        e.lastAt ? new Date(e.lastAt as string | Date).toISOString() : null,
      ]),
    );

    const upcoming = ids.length ? await database.select({ patientId: appointments.patientId, at: appointments.scheduledStart })
      .from(appointments).where(and(inArray(appointments.patientId, ids), eq(appointments.doctorId, doctorId),
        inArray(appointments.status, ["REQUESTED", "CONFIRMED"]), gte(appointments.scheduledStart, new Date())))
      .orderBy(asc(appointments.scheduledStart)) : [];
    const nextByPatient = new Map<string, string>();
    for (const appointment of upcoming) {
      if (!nextByPatient.has(appointment.patientId)) nextByPatient.set(appointment.patientId, appointment.at.toISOString());
    }
    return matched
      .map((r) => {
        const identity = r.identity ? decryptMinimal(r.identity) : null;
        return {
          patient_id: r.patientId,
          full_name: identity?.full_name ?? "",
          phone: identity?.phone ?? "",
          date_of_birth: identity?.date_of_birth ?? null,
          sex_at_registration: identity?.sex_at_registration ?? null,
          status: r.patientStatus,
          relationship_status: r.relationshipStatus,
          last_encounter_at: lastByPatient.get(r.patientId) ?? null,
          next_appointment_at: nextByPatient.get(r.patientId) ?? null,
        };
      })
      .filter((patient) => filter !== "upcoming" || patient.next_appointment_at !== null)
      .sort((a, b) => filter === "upcoming"
        ? (a.next_appointment_at ?? "").localeCompare(b.next_appointment_at ?? "")
        : (b.last_encounter_at ?? "").localeCompare(a.last_encounter_at ?? ""));
  });

  app.get<{ Params: { patient_id: string } }>(
    "/doctor/patients/:patient_id/workspace",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const patientId = request.params.patient_id;
      const database = requireDb();
      // Relationship is not permission: a related doctor always sees their own
      // records; everything else needs an active, unexpired consent scope.
      const active = await activeConsentsForDoctor(database, patientId, doctorId);
      const allowed = active.length > 0 || (await authorizePatientAccess(request.auth, patientId));
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient record");
      }
      const scopes = active.flatMap((c) => c.scopes);
      const hasGroup = (type: string) => scopes.some((x) => x.resourceType === type && x.resourceId === null);
      const scopedIds = (type: string) => scopes.flatMap((x) => (x.resourceType === type && x.resourceId ? [x.resourceId] : []));
      const medicationConsent = consentCovering(active, "MEDICATION");
      const encounterAll = hasGroup("ENCOUNTER") || hasGroup("TIMELINE");
      const documentAll = hasGroup("DOCUMENT") || hasGroup("TIMELINE");
      const documentListAll = hasGroup("DOCUMENT");

      // Access ledger: a doctor opening the workspace is a sensitive read; the
      // row carries the consent that widened it, if any.
      await logAccess(request, {
        patientId,
        purpose: active[0]?.purpose ?? "Consultation",
        resourceType: "PATIENT_WORKSPACE",
        resourceId: patientId,
        action: "VIEW",
        consentId: active[0]?.id ?? null,
      });

      const [patientRow] = await database
        .select({ status: patients.status })
        .from(patients)
        .where(eq(patients.id, patientId))
        .limit(1);
      const identityRows = await database
        .select()
        .from(patientIdentity)
        .where(eq(patientIdentity.patientId, patientId))
        .limit(1);
      const identity = identityRows[0];
      if (!identity) {
        return error(request, reply, 404, "NOT_FOUND", "Patient identity not found");
      }
      const decrypted = decryptMinimal(identity);

      // Own records always; patient-held and other clinicians' records only where a consent scope covers them.
      const encounterScope: SQL | undefined = or(
        eq(encounters.relatedDoctorId, doctorId),
        encounterAll ? eq(encounters.patientId, patientId) : undefined,
        scopedIds("ENCOUNTER").length ? inArray(encounters.id, scopedIds("ENCOUNTER")) : undefined,
      );
      const documentScope: SQL | undefined = or(
        and(eq(documents.uploadedByActorType, "DOCTOR"), eq(documents.uploadedByActorId, doctorId)),
        documentAll ? eq(documents.patientId, patientId) : undefined,
        scopedIds("DOCUMENT").length ? inArray(documents.id, scopedIds("DOCUMENT")) : undefined,
      );
      const [apptRows, encRows, allDocumentRows, rxRows, medications] = await Promise.all([
        database.select().from(appointments)
          .where(and(eq(appointments.patientId, patientId), eq(appointments.doctorId, doctorId)))
          .orderBy(desc(appointments.scheduledStart)),
        database.select().from(encounters)
          .where(and(eq(encounters.patientId, patientId), encounterScope))
          .orderBy(desc(encounters.startedAt)),
        database.select().from(documents)
          .where(and(eq(documents.patientId, patientId), documentScope, isNull(documents.deletedAt)))
          .orderBy(desc(documents.createdAt)),
        database.select({ id: prescriptions.id, encounterId: prescriptions.encounterId, finalizedAt: prescriptionVersions.finalizedAt })
          .from(prescriptions).innerJoin(prescriptionVersions, eq(prescriptionVersions.id, prescriptions.currentVersionId))
          .where(and(eq(prescriptions.patientId, patientId), eq(prescriptions.doctorId, doctorId)))
          .orderBy(desc(prescriptionVersions.finalizedAt)),
        medicationsForPatient(patientId, medicationConsent ? undefined : doctorId),
      ]);
      // TIMELINE-only consent shows entries but not the document list or reports.
      const documentRows = !hasGroup("TIMELINE") || documentListAll ? allDocumentRows : allDocumentRows.filter((doc) => (doc.uploadedByActorType === "DOCTOR" && doc.uploadedByActorId === doctorId) || documentListAll || scopeCovers(scopes, "DOCUMENT", doc.id));
      const reportRows = documentRows.length ? await database.select({ id: labReports.id }).from(labReports)
        .where(and(eq(labReports.patientId, patientId), inArray(labReports.documentId, documentRows.map((doc) => doc.id)))) : [];
      const reports = (await Promise.all(reportRows.map((report) => loadReportView(report.id)))).filter((report) => report !== null);

      const appointmentsView = apptRows.map((a) => appointmentView(a, decrypted.full_name));

      const timeline = [
        ...encRows.map((e) => ({
          kind: "encounter" as const,
          id: e.id,
          provenance: e.initiatedByActorType === "DOCTOR" ? "DOCTOR_AUTHORED" as const : "PATIENT_REPORTED" as const,
          at: e.startedAt.toISOString(),
          label: `Encounter · ${e.encounterType}${e.chiefConcern ? ` — ${e.chiefConcern}` : ""}`,
        })),
        ...apptRows.map((a) => ({
          kind: "appointment" as const,
          id: a.id,
          provenance: undefined,
          at: a.scheduledStart.toISOString(),
          label: `Appointment · ${a.status}`,
        })),
        ...allDocumentRows.map((doc) => ({ kind: "document" as const, id: doc.id, provenance: "SOURCE_DOCUMENT" as const, at: doc.createdAt.toISOString(), label: doc.originalFilename })),
        ...rxRows.map((rx) => ({ kind: "prescription" as const, id: rx.id, provenance: "DOCTOR_AUTHORED" as const, at: rx.finalizedAt.toISOString(), label: "Prescription finalized" })),
      ].sort((a, b) => b.at.localeCompare(a.at));

      return {
        patient_id: patientId,
        status: patientRow?.status ?? "UNKNOWN",
        identity: {
          full_name: decrypted.full_name,
          phone_last4: decrypted.phone.slice(-4),
          date_of_birth: decrypted.date_of_birth,
          sex_at_registration: decrypted.sex_at_registration,
        },
        allergies: [],
        consent_active: active.length > 0,
        access_scope: active.length > 0 ? "CONSENT_SCOPED" : "DOCTOR_OWN_RECORDS",
        locked_sections: lockedSections(active),
        current_concern: encRows[0]?.chiefConcern ?? null,
        current_concern_at: encRows[0]?.startedAt.toISOString() ?? null,
        last_updated_at: [identity.updatedAt, ...encRows.map((row) => row.updatedAt), ...apptRows.map((row) => row.updatedAt), ...documentRows.map((row) => row.createdAt), ...rxRows.map((row) => row.finalizedAt)]
          .filter((value): value is Date => value instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0]?.toISOString() ?? null,
        medications,
        reports,
        documents: documentRows.map((doc) => ({ document_id: doc.id, document_type: doc.documentType, original_filename: doc.originalFilename, mime_type: doc.mimeType, file_size_bytes: doc.fileSizeBytes, processing_status: doc.processingStatus, created_at: doc.createdAt.toISOString(), view_url: null })),
        prescriptions: rxRows.map((rx) => ({ id: rx.id, encounter_id: rx.encounterId, finalized_at: rx.finalizedAt.toISOString() })),
        relationships: [],
        appointments: appointmentsView,
        timeline,
      };
    },
  );
}
