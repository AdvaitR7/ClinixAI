import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import {
  consentCreateSchema,
  consentPreviewRequestSchema,
  removalRequestCreateSchema,
  removalResolveSchema,
  removalRouteSchema,
  type AccessReceipt,
  type ConsentView,
  type LedgerCategory,
  type RemovalRequestView,
} from "@clinix/schemas";
import { requireDoctor, requirePatient, requirePracticeRole } from "../auth/guards.js";
import { practiceDoctorIds } from "../practices/scope.js";
import { logAccess } from "../audit/log.js";
import { patientNames } from "../appointments/map.js";
import { error, requireDb } from "../http.js";
import {
  accessEvents,
  consentScopes,
  consents,
  doctors,
  documents,
  encounters,
  prescriptions,
  profiles,
  recordRemovalRequests,
} from "../schema.js";
import { consentsForPatient, effectiveStatus, expiryDate, type ConsentWithScopes } from "./consent.js";
import { actionLabel, categoryOf, resourceLabel } from "./ledger.js";

/** Patient-authored ledger actions that stay visible; routine patient self-reads are hidden. */
const PATIENT_VISIBLE_ACTIONS = ["SHARE", "REVOKE_ACCESS", "REMOVAL_REQUEST"];
const LEDGER_PAGE_SIZE = 20;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTOR_ROLE_LABELS: Record<string, string> = {
  PATIENT: "You",
  DOCTOR: "Doctor",
  CLINIC_STAFF: "Clinic staff",
  ADMIN: "CliniX administrator",
  AI_SERVICE: "AI service",
  SYSTEM: "CliniX system",
};
const REMOVAL_RESOURCE_TYPES = ["DOCUMENT", "ENCOUNTER", "PRESCRIPTION"];

/** Record groups offered in the scope picker; the last two have no data source yet. */
const PREVIEW_SCOPES = [
  { resource_type: "ENCOUNTER", label: "This consultation packet", recommended: true, available: true, unavailable_reason: null },
  { resource_type: "DOCUMENT", label: "Lab reports and documents", recommended: true, available: true, unavailable_reason: null },
  { resource_type: "MEDICATION", label: "Medication history", recommended: false, available: true, unavailable_reason: null },
  { resource_type: "TIMELINE", label: "Full health timeline", recommended: false, available: true, unavailable_reason: null },
  { resource_type: "CHECKIN_PACKET", label: "AI check-in result", recommended: false, available: true, unavailable_reason: null },
  { resource_type: "ALLERGY", label: "Known allergies", recommended: false, available: false, unavailable_reason: "No allergy record exists in CliniX yet." },
  { resource_type: "MENTAL_WELLNESS", label: "Mental wellness", recommended: false, available: false, unavailable_reason: "No mental wellness record exists in CliniX yet." },
];

/** Shapes a consent row for the patient UI with its effective (expiry-aware) status. */
function consentView(c: ConsentWithScopes, doctor: { name: string; speciality: string | null }, now: Date): ConsentView {
  return {
    id: c.id,
    doctor_id: c.granteeId,
    doctor_name: doctor.name,
    speciality: doctor.speciality,
    purpose: c.purpose,
    status: effectiveStatus(c, now),
    starts_at: c.startsAt.toISOString(),
    expires_at: c.expiresAt ? c.expiresAt.toISOString() : null,
    revoked_at: c.revokedAt ? c.revokedAt.toISOString() : null,
    scopes: c.scopes.map((s) => ({
      resource_type: s.resourceType as ConsentView["scopes"][number]["resource_type"],
      ...(s.resourceId ? { resource_id: s.resourceId } : {}),
    })),
  };
}

type RemovalRow = typeof recordRemovalRequests.$inferSelect;

/** Shapes a removal request for patient, doctor and staff views. */
function removalView(r: RemovalRow, names: { patient: string | null; doctor: string | null }): RemovalRequestView {
  return {
    id: r.id,
    patient_id: r.patientId,
    patient_name: names.patient,
    target_doctor_id: r.targetActorId,
    target_doctor_name: names.doctor,
    resource_type: r.resourceType,
    resource_id: r.resourceId,
    reason: r.reason,
    status: r.status as RemovalRequestView["status"],
    requested_at: r.requestedAt.toISOString(),
    routed_at: r.routedAt ? r.routedAt.toISOString() : null,
    routing_note: r.routingNote,
    resolved_at: r.resolvedAt ? r.resolvedAt.toISOString() : null,
    resolution_note: r.resolutionNote,
    decisions: Array.isArray(r.decisions) ? (r.decisions as RemovalRequestView["decisions"]) : [],
  };
}

/** Display names of doctors keyed by doctor id. */
async function doctorNames(database: ReturnType<typeof requireDb>, ids: string[]) {
  if (ids.length === 0) return new Map<string, { name: string; speciality: string | null }>();
  const rows = await database
    .select({ id: doctors.id, name: profiles.displayName, speciality: doctors.speciality })
    .from(doctors)
    .innerJoin(profiles, eq(profiles.id, doctors.profileId))
    .where(inArray(doctors.id, ids));
  return new Map(rows.map((r) => [r.id, { name: r.name, speciality: r.speciality }]));
}

export async function privacyRoutes(app: FastifyInstance) {
  // --- Consent (API §16) ---

  /** Suggests record groups for a doctor/encounter; never grants anything. */
  app.post("/patients/self/consents/preview", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const parsed = consentPreviewRequestSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid consent preview");
    const database = requireDb();
    const names = await doctorNames(database, [parsed.data.doctor_id]);
    if (!names.has(parsed.data.doctor_id)) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
    if (parsed.data.encounter_id) {
      const own = await database
        .select({ id: encounters.id })
        .from(encounters)
        .where(and(eq(encounters.id, parsed.data.encounter_id), eq(encounters.patientId, patientId)))
        .limit(1);
      if (own.length === 0) return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
    }
    return {
      suggested_scopes: PREVIEW_SCOPES.map((s) =>
        s.resource_type === "ENCOUNTER" && !parsed.data.encounter_id ? { ...s, recommended: false } : s,
      ),
    };
  });

  /** Grants a scoped, time-boxed consent to one doctor. */
  app.post("/patients/self/consents", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const parsed = consentCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid consent");
    const body = parsed.data;
    const database = requireDb();

    const names = await doctorNames(database, [body.doctor_id]);
    const doctor = names.get(body.doctor_id);
    if (!doctor) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");

    // Specific records must belong to this patient; whole-group scopes need no id.
    for (const [type, table] of [["ENCOUNTER", encounters], ["DOCUMENT", documents]] as const) {
      const ids = body.scopes.filter((s) => s.resource_type === type && s.resource_id).map((s) => s.resource_id as string);
      if (ids.length === 0) continue;
      const owned = await database
        .select({ id: table.id })
        .from(table)
        .where(and(inArray(table.id, ids), eq(table.patientId, patientId)));
      if (owned.length !== new Set(ids).size) {
        return error(request, reply, 404, "NOT_FOUND", "A selected record was not found");
      }
    }

    const now = new Date();
    const [created] = await database
      .insert(consents)
      .values({
        patientId,
        granteeType: "DOCTOR",
        granteeId: body.doctor_id,
        purpose: body.purpose,
        startsAt: now,
        expiresAt: expiryDate(body.expiry, now),
      })
      .returning();
    await database.insert(consentScopes).values(
      body.scopes.map((s) => ({
        consentId: created.id,
        resourceType: s.resource_type,
        resourceId: s.resource_id ?? null,
        permission: "READ",
      })),
    );
    await logAccess(request, {
      patientId,
      purpose: body.purpose,
      resourceType: "CONSENT",
      resourceId: created.id,
      action: "SHARE",
      consentId: created.id,
    });
    const view = consentView(
      { ...created, scopes: body.scopes.map((s) => ({ resourceType: s.resource_type, resourceId: s.resource_id ?? null })) },
      doctor,
      now,
    );
    return reply.code(201).send(view);
  });

  /** Consents the patient granted, newest first; each carries its effective status. */
  app.get("/patients/self/consents", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const database = requireDb();
    const rows = await consentsForPatient(database, patientId);
    const names = await doctorNames(database, [...new Set(rows.map((r) => r.granteeId))]);
    const now = new Date();
    return rows.map((r) => consentView(r, names.get(r.granteeId) ?? { name: "Doctor", speciality: null }, now));
  });

  /** Revokes future access. Idempotent; never erases records the doctor authored. */
  app.post<{ Params: { id: string } }>("/patients/self/consents/:id/revoke", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const database = requireDb();
    const rows = await database
      .select()
      .from(consents)
      .where(and(eq(consents.id, request.params.id), eq(consents.patientId, patientId)))
      .limit(1);
    if (rows.length === 0) return error(request, reply, 404, "NOT_FOUND", "Consent not found");
    const consent = rows[0];
    if (consent.status !== "REVOKED") {
      const now = new Date();
      await database
        .update(consents)
        .set({ status: "REVOKED", revokedAt: now, updatedAt: now })
        .where(eq(consents.id, consent.id));
      await logAccess(request, {
        patientId,
        purpose: consent.purpose,
        resourceType: "CONSENT",
        resourceId: consent.id,
        action: "REVOKE_ACCESS",
        consentId: consent.id,
      });
    }
    return reply.code(200).send({ ok: true });
  });

  // --- Access ledger (API §28) ---

  /** Read-only, human-readable access history with category filter and cursor paging. */
  app.get<{ Querystring: { category?: string; cursor?: string } }>(
    "/patients/self/access-ledger",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;
      const category = request.query.category as LedgerCategory | undefined;
      if (category && !["CLINICAL", "ADMIN", "AI"].includes(category)) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid ledger category");
      }
      const cursor = request.query.cursor ? new Date(request.query.cursor) : null;
      if (cursor && Number.isNaN(cursor.getTime())) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid cursor");
      }
      const database = requireDb();
      const visible = and(
        eq(accessEvents.patientId, patientId),
        or(sql`${accessEvents.actorType} <> 'PATIENT'`, inArray(accessEvents.action, PATIENT_VISIBLE_ACTIONS)),
      );

      const groups = await database
        .select({ actorType: accessEvents.actorType, action: accessEvents.action, n: sql<number>`count(*)::int` })
        .from(accessEvents)
        .where(visible)
        .groupBy(accessEvents.actorType, accessEvents.action);
      const counts = { all: 0, clinical: 0, admin: 0, ai: 0 };
      for (const g of groups) {
        counts.all += g.n;
        counts[categoryOf(g).toLowerCase() as "clinical" | "admin" | "ai"] += g.n;
      }

      // Category is derived, so filter in memory over the page window (prototype scale).
      const rows = await database
        .select({
          id: accessEvents.id,
          createdAt: accessEvents.createdAt,
          actorType: accessEvents.actorType,
          actorName: profiles.displayName,
          action: accessEvents.action,
          purpose: accessEvents.purpose,
          resourceType: accessEvents.resourceType,
          consentId: accessEvents.consentId,
        })
        .from(accessEvents)
        .leftJoin(profiles, eq(profiles.id, accessEvents.actorId))
        .where(cursor ? and(visible, lt(accessEvents.createdAt, cursor)) : visible)
        .orderBy(desc(accessEvents.createdAt))
        .limit(500);

      const filtered = rows.filter((r) => !category || categoryOf(r) === category);
      const page = filtered.slice(0, LEDGER_PAGE_SIZE);
      return {
        events: page.map((r) => ({
          id: r.id,
          timestamp: r.createdAt.toISOString(),
          category: categoryOf(r),
          actor: {
            type: r.actorType,
            display_name: r.actorType === "AI_SERVICE" ? "ClinixAI" : (r.actorName ?? "CliniX staff"),
          },
          action: actionLabel(r.action),
          purpose: r.purpose,
          resource_label: resourceLabel(r.resourceType),
          consent_id: r.consentId,
        })),
        total: counts.all,
        counts,
        next_cursor: filtered.length > LEDGER_PAGE_SIZE ? page[page.length - 1].createdAt.toISOString() : null,
      };
    },
  );

  /**
   * One ledger row as a receipt (Page 13a). Owner-only and limited to the same rows the ledger shows,
   * so a hidden patient self-read can never be fetched by id. Only structured fields are returned.
   */
  app.get<{ Params: { id: string } }>("/patients/self/access-events/:id", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    if (!UUID_RE.test(request.params.id)) return error(request, reply, 404, "NOT_FOUND", "Access event not found");
    const database = requireDb();
    const [row] = await database
      .select({
        id: accessEvents.id,
        createdAt: accessEvents.createdAt,
        actorType: accessEvents.actorType,
        actorName: profiles.displayName,
        action: accessEvents.action,
        purpose: accessEvents.purpose,
        resourceType: accessEvents.resourceType,
        consentId: accessEvents.consentId,
      })
      .from(accessEvents)
      .leftJoin(profiles, eq(profiles.id, accessEvents.actorId))
      .where(
        and(
          eq(accessEvents.id, request.params.id),
          eq(accessEvents.patientId, patientId),
          or(sql`${accessEvents.actorType} <> 'PATIENT'`, inArray(accessEvents.action, PATIENT_VISIBLE_ACTIONS)),
        ),
      )
      .limit(1);
    if (!row) return error(request, reply, 404, "NOT_FOUND", "Access event not found");

    let consent: AccessReceipt["consent"] = null;
    if (row.consentId) {
      const [grant] = await database
        .select({ id: consents.id, purpose: consents.purpose })
        .from(consents)
        .where(and(eq(consents.id, row.consentId), eq(consents.patientId, patientId)))
        .limit(1);
      if (grant) {
        const scopes = await database
          .select({ resourceType: consentScopes.resourceType })
          .from(consentScopes)
          .where(eq(consentScopes.consentId, grant.id));
        consent = { id: grant.id, purpose: grant.purpose, scopes: [...new Set(scopes.map((s) => resourceLabel(s.resourceType)))] };
      }
    }
    const receipt: AccessReceipt = {
      id: row.id,
      timestamp: row.createdAt.toISOString(),
      category: categoryOf(row),
      actor: {
        type: row.actorType,
        role_label: ACTOR_ROLE_LABELS[row.actorType] ?? "CliniX",
        display_name: row.actorType === "AI_SERVICE" ? "ClinixAI" : (row.actorName ?? "CliniX staff"),
      },
      action: actionLabel(row.action),
      resource_label: resourceLabel(row.resourceType),
      purpose: row.purpose,
      legal_basis: consent ? "Your consent" : null,
      consent,
    };
    return receipt;
  });

  // --- Record removal (API §29) ---

  /** Patient asks a doctor to remove a record from active views; creates a request only. */
  app.post("/patients/self/record-removal-requests", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const parsed = removalRequestCreateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid removal request");
    const body = parsed.data;
    if (!REMOVAL_RESOURCE_TYPES.includes(body.resource_type)) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Unsupported record type");
    }
    const database = requireDb();
    const names = await doctorNames(database, [body.target_actor_id]);
    if (!names.has(body.target_actor_id)) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");

    if (body.resource_id) {
      const table = { DOCUMENT: documents, ENCOUNTER: encounters, PRESCRIPTION: prescriptions }[body.resource_type as "DOCUMENT" | "ENCOUNTER" | "PRESCRIPTION"];
      const owned = await database
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, body.resource_id), eq(table.patientId, patientId)))
        .limit(1);
      if (owned.length === 0) return error(request, reply, 404, "NOT_FOUND", "Record not found");
    }

    const [created] = await database
      .insert(recordRemovalRequests)
      .values({
        patientId,
        targetActorType: "DOCTOR",
        targetActorId: body.target_actor_id,
        resourceType: body.resource_type,
        resourceId: body.resource_id ?? null,
        reason: body.reason ?? null,
      })
      .returning();
    await logAccess(request, {
      patientId,
      purpose: "Record removal request",
      resourceType: body.resource_type,
      resourceId: body.resource_id,
      action: "REMOVAL_REQUEST",
    });
    return reply.code(201).send(removalView(created, { patient: null, doctor: names.get(body.target_actor_id)?.name ?? null }));
  });

  /** Patient tracking: own requests with status, written reason and per-record outcome. */
  app.get("/patients/self/record-removal-requests", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const database = requireDb();
    const rows = await database
      .select()
      .from(recordRemovalRequests)
      .where(eq(recordRemovalRequests.patientId, patientId))
      .orderBy(desc(recordRemovalRequests.requestedAt));
    const names = await doctorNames(database, rows.flatMap((r) => (r.targetActorId ? [r.targetActorId] : [])));
    return rows.map((r) => removalView(r, { patient: null, doctor: r.targetActorId ? (names.get(r.targetActorId)?.name ?? null) : null }));
  });

  /** Doctor inbox: requests addressed to this doctor. */
  app.get("/doctor/record-removal-requests", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const database = requireDb();
    const rows = await database
      .select()
      .from(recordRemovalRequests)
      .where(and(eq(recordRemovalRequests.targetActorType, "DOCTOR"), eq(recordRemovalRequests.targetActorId, doctorId)))
      .orderBy(desc(recordRemovalRequests.requestedAt));
    const patients_ = await patientNames([...new Set(rows.map((r) => r.patientId))]);
    const names = await doctorNames(database, [doctorId]);
    return rows.map((r) => removalView(r, { patient: patients_.get(r.patientId) ?? null, doctor: names.get(doctorId)?.name ?? null }));
  });

  /** The responsible doctor decides. Idempotent for the same outcome; a different outcome is a conflict. */
  app.post<{ Params: { id: string } }>("/doctor/record-removal-requests/:id/resolve", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    // The addressed doctor decides; a practice OWNER may also decide for the practice's doctors.
    const ownedPractices = (request.auth.memberships ?? []).filter((m) => m.role === "OWNER");
    const deciderScope = [doctorId, ...(await Promise.all(ownedPractices.map((m) => practiceDoctorIds(m.practiceId)))).flat()];
    const parsed = removalResolveSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid decision");
    const body = parsed.data;
    if (body.outcome === "PARTIALLY_APPROVED" && !(body.decisions && body.decisions.length > 0)) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Partial approval needs a per-record decision");
    }
    const database = requireDb();
    const rows = await database
      .select()
      .from(recordRemovalRequests)
      .where(and(eq(recordRemovalRequests.id, request.params.id), eq(recordRemovalRequests.targetActorId, doctorId)))
      .limit(1);
    if (rows.length === 0) return error(request, reply, 404, "NOT_FOUND", "Request not found");
    const existing = rows[0];
    if (existing.resolvedAt) {
      if (existing.status === body.outcome) {
        return removalView(existing, { patient: null, doctor: null });
      }
      return error(request, reply, 409, "ALREADY_RESOLVED", "This request was already decided");
    }
    const now = new Date();
    const [updated] = await database
      .update(recordRemovalRequests)
      .set({
        status: body.outcome,
        resolvedAt: now,
        resolutionNote: body.reason ?? null,
        resolvedByProfileId: request.auth.profileId,
        decisions: body.decisions ?? null,
      })
      .where(eq(recordRemovalRequests.id, existing.id))
      .returning();
    await logAccess(request, {
      patientId: existing.patientId,
      purpose: "Record removal decision",
      resourceType: existing.resourceType,
      resourceId: existing.resourceId ?? undefined,
      action: "REMOVAL_DECISION",
    });
    return removalView(updated ?? { ...existing, status: body.outcome, resolvedAt: now }, { patient: null, doctor: null });
  });

  /**
   * Routes a request to a responsible doctor. A doctor routes their own requests;
   * an active practice member routes requests held by a doctor of that practice
   * to another doctor of the same practice. Staff cannot decide a request.
   */
  app.post<{ Params: { id: string } }>("/record-removal-requests/:id/route", async (request, reply) => {
    let scopeIds: string[];
    if (request.auth.role === "DOCTOR" && request.auth.doctorId) {
      scopeIds = [request.auth.doctorId];
    } else {
      const member = requirePracticeRole(request, reply, ["RECEPTION", "ASSISTANT", "OWNER"]);
      if ("statusCode" in member) return member;
      scopeIds = await practiceDoctorIds(member.practiceId);
      if (scopeIds.length === 0) return error(request, reply, 403, "FORBIDDEN", "Practice has no doctors");
    }
    const parsed = removalRouteSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid routing");
    const database = requireDb();
    const target = await doctorNames(database, [parsed.data.doctor_id]);
    if (!target.has(parsed.data.doctor_id)) return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
    if (request.auth.role !== "DOCTOR" && !scopeIds.includes(parsed.data.doctor_id)) {
      return error(request, reply, 403, "FORBIDDEN", "Staff can route only within their practice");
    }
    const rows = await database
      .select()
      .from(recordRemovalRequests)
      .where(and(eq(recordRemovalRequests.id, request.params.id), inArray(recordRemovalRequests.targetActorId, scopeIds)))
      .limit(1);
    if (rows.length === 0) return error(request, reply, 404, "NOT_FOUND", "Request not found");
    if (rows[0].resolvedAt) return error(request, reply, 409, "ALREADY_RESOLVED", "This request was already decided");
    await database
      .update(recordRemovalRequests)
      .set({
        targetActorId: parsed.data.doctor_id,
        status: "ROUTED",
        routedAt: new Date(),
        routedByProfileId: request.auth.profileId,
        routingNote: parsed.data.note ?? null,
      })
      .where(eq(recordRemovalRequests.id, rows[0].id));
    return reply.code(200).send({ ok: true });
  });
}
