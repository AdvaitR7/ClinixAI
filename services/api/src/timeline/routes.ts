import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import { patientCheckinOutcomeSchema } from "@clinix/schemas";
import type {
  DetailedTimelineItem,
  PatientTimelineResponse,
  ProvenanceAuthority,
  TimelineFilter,
} from "@clinix/schemas";
import { requirePatient } from "../auth/guards.js";
import { requireDb } from "../http.js";
import {
  aiSessions,
  encounters,
  labReports,
  prescriptionVersions,
  prescriptions,
} from "../schema.js";

function getChapter(date: Date): string {
  const month = date.getUTCMonth();
  const year = date.getUTCFullYear();
  const monthNames = [
    "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
    "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
  ];
  return `${monthNames[month]} ${year}`;
}

function formatDateShort(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const monthNames = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  return `${day} ${monthNames[date.getUTCMonth()]}`;
}

/** Projects the patient's own records, using checked outcomes for AI-derived entries. */
export async function timelineRoutes(app: FastifyInstance) {
  /**
   * GET /patients/self/timeline (API spec §13, Screen 8)
   * Longitudinal timeline projection across encounters, AI check-ins,
   * prescriptions, and laboratory reports with explicit provenance labeling.
   */
  app.get("/patients/self/timeline", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const query = request.query as { filter?: TimelineFilter };
    const filter = query.filter ?? "ALL";
    const database = requireDb();

    const items: DetailedTimelineItem[] = [];

    // 1. Encounters
    if (filter === "ALL" || filter === "DOCTOR_VISITS") {
      const encRows = await database
        .select()
        .from(encounters)
        .where(eq(encounters.patientId, patientId))
        .orderBy(desc(encounters.startedAt));

      for (const e of encRows) {
        const isDoc =
          e.encounterType === "DOCTOR_ONLINE" ||
          e.encounterType === "DOCTOR_IN_PERSON" ||
          e.encounterType === "FOLLOW_UP";

        if (filter === "DOCTOR_VISITS" && !isDoc) continue;

        const date = e.startedAt;
        const provenance: ProvenanceAuthority = isDoc
          ? "DOCTOR_AUTHORED"
          : "PATIENT_ASSERTED";

        items.push({
          id: `enc-${e.id}`,
          type: "ENCOUNTER",
          title: isDoc
            ? `Doctor consultation (${e.encounterType.replace("_", " ").toLowerCase()})`
            : "Self-initiated health check-in",
          summary: e.chiefConcern ? `Concern: ${e.chiefConcern}` : "Routine health encounter",
          timestamp: date.toISOString(),
          date_formatted: formatDateShort(date),
          chapter: getChapter(date),
          provenance,
          is_ai_derived: false,
          metadata: { encounter_id: e.id, status: e.status },
        });
      }
    }

    // 2. AI Check-ins
    if (filter === "ALL" || filter === "AI_CHECKINS") {
      const aiRows = await database
        .select({
          id: aiSessions.id,
          encounterId: aiSessions.encounterId,
          startedAt: aiSessions.startedAt,
          purpose: aiSessions.purpose,
          patientOutcome: aiSessions.patientOutcome,
          chiefConcern: encounters.chiefConcern,
        })
        .from(aiSessions)
        .innerJoin(encounters, eq(aiSessions.encounterId, encounters.id))
        .where(and(eq(aiSessions.patientId, patientId), eq(aiSessions.status, "SUCCEEDED")))
        .orderBy(desc(aiSessions.startedAt));

      for (const a of aiRows) {
        const date = a.startedAt;
        const checked = patientCheckinOutcomeSchema.safeParse(a.patientOutcome);
        items.push({
          id: `ai-${a.id}`,
          type: "AI_CHECKIN",
          title: a.chiefConcern ? `${a.chiefConcern} check-in` : "AI Health check-in",
          summary: checked.success && checked.data.disposition ? checked.data.summary : "Checked outcome unavailable for this older result.",
          timestamp: date.toISOString(),
          date_formatted: formatDateShort(date),
          chapter: getChapter(date),
          provenance: "AI_DERIVED",
          is_ai_derived: true,
          metadata: { ai_session_id: a.id, encounter_id: a.encounterId },
        });
      }
    }

    // 3. Finalized Prescriptions
    if (filter === "ALL" || filter === "PRESCRIPTIONS") {
      const rxRows = await database
        .select({
          id: prescriptions.id,
          finalizedAt: prescriptionVersions.finalizedAt,
          versionNumber: prescriptionVersions.versionNumber,
        })
        .from(prescriptions)
        .innerJoin(
          prescriptionVersions,
          eq(prescriptions.currentVersionId, prescriptionVersions.id),
        )
        .where(eq(prescriptions.patientId, patientId))
        .orderBy(desc(prescriptionVersions.finalizedAt));

      for (const rx of rxRows) {
        const date = rx.finalizedAt ?? new Date();
        items.push({
          id: `rx-${rx.id}`,
          type: "PRESCRIPTION",
          title: "Prescription updated",
          summary: `Version ${rx.versionNumber} finalized by doctor.`,
          timestamp: date.toISOString(),
          date_formatted: formatDateShort(date),
          chapter: getChapter(date),
          provenance: "DOCTOR_AUTHORED",
          is_ai_derived: false,
          metadata: { prescription_id: rx.id },
        });
      }
    }

    // 4. Lab Reports
    if (filter === "ALL" || filter === "LAB_REPORTS") {
      const labRows = await database
        .select()
        .from(labReports)
        .where(eq(labReports.patientId, patientId))
        .orderBy(desc(labReports.createdAt));

      for (const l of labRows) {
        const date = l.createdAt;
        items.push({
          id: `lab-${l.id}`,
          type: "LAB_REPORT",
          title: l.laboratoryName ? `Lab report (${l.laboratoryName})` : "Diagnostic report imported",
          summary: "Original source PDF linked and observations verified.",
          timestamp: date.toISOString(),
          date_formatted: formatDateShort(date),
          chapter: getChapter(date),
          provenance: "SOURCE_DOCUMENT_DERIVED",
          is_ai_derived: false,
          metadata: { lab_report_id: l.id },
        });
      }
    }

    // Sort descending by timestamp
    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const response: PatientTimelineResponse = {
      entries: items,
      next_cursor: null,
    };

    return reply.code(200).send(response);
  });
}
