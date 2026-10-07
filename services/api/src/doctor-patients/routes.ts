import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, max } from "drizzle-orm";
import { doctorCreatePatientSchema } from "@clinix/schemas";
import { authorizePatientAccess, requireDoctor } from "../auth/guards.js";
import { hashIdentity } from "../crypto.js";
import { logAccess } from "../audit/log.js";
import { error, requireDb } from "../http.js";
import { decryptMinimal, encryptPatientIdentity, isAdult } from "../patients/identity.js";
import {
  appointments,
  encounters,
  patientDoctorRelationships,
  patientIdentity,
  patients,
} from "../schema.js";
import { appointmentView } from "../appointments/map.js";

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
    const body = parsed.data;
    if (!isAdult(body.date_of_birth)) {
      return error(request, reply, 403, "AGE_REQUIREMENT", "CliniX is for adults aged 18 and over");
    }

    const database = requireDb();

    // Duplicate check: deterministic phone_hash lookup, never decrypts (Screen 22).
    const phoneHash = hashIdentity(body.mobile);
    const dup = await database
      .select({ patientId: patientIdentity.patientId })
      .from(patientIdentity)
      .where(eq(patientIdentity.phoneHash, phoneHash))
      .limit(1);
    if (dup.length > 0) {
      return error(request, reply, 409, "DUPLICATE_PATIENT", "A patient with this mobile number already exists");
    }

    const inserted = await database
      .insert(patients)
      .values({
        status: "UNCLAIMED",
        createdByActorType: "DOCTOR",
        createdByActorId: doctorId,
      })
      .returning({ id: patients.id });
    const patientId = inserted[0].id;

    await database.insert(patientIdentity).values({
      patientId,
      ...encryptPatientIdentity({
        full_name: body.full_name,
        phone: body.mobile,
        date_of_birth: body.date_of_birth,
        sex_at_registration: body.sex_at_registration,
      }),
    });

    // Claim invitation deferred to Phase 3 (claim loop).
    await database.insert(patientDoctorRelationships).values({
      patientId,
      doctorId,
      relationshipType: body.relationship_type ?? "PRIMARY_PHYSICIAN",
      isPreferred: body.preferred ?? false,
    });

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
          return decryptMinimal(r.identity).full_name.toLowerCase().includes(lower);
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
            .where(inArray(encounters.patientId, ids))
            .groupBy(encounters.patientId);
    const lastByPatient = new Map(
      lastEncounters.map((e) => [
        e.patientId,
        e.lastAt ? new Date(e.lastAt as string | Date).toISOString() : null,
      ]),
    );

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
        };
      })
      .sort((a, b) =>
        (b.last_encounter_at ?? "").localeCompare(a.last_encounter_at ?? ""),
      );
  });

  app.get<{ Params: { patient_id: string } }>(
    "/doctor/patients/:patient_id/workspace",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const patientId = request.params.patient_id;
      const allowed = await authorizePatientAccess(request.auth, patientId);
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient record");
      }

      // Access ledger: a doctor opening the workspace is a sensitive read.
      await logAccess(request, {
        patientId,
        purpose: "Consultation",
        resourceType: "PATIENT_WORKSPACE",
        resourceId: patientId,
        action: "VIEW",
      });

      const database = requireDb();
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

      const [latestEncounter, apptRows, encRows] = await Promise.all([
        database
          .select({ chiefConcern: encounters.chiefConcern })
          .from(encounters)
          .where(eq(encounters.patientId, patientId))
          .orderBy(desc(encounters.startedAt))
          .limit(1),
        database
          .select()
          .from(appointments)
          .where(eq(appointments.patientId, patientId))
          .orderBy(desc(appointments.scheduledStart))
          .limit(20),
        database
          .select()
          .from(encounters)
          .where(eq(encounters.patientId, patientId))
          .orderBy(desc(encounters.startedAt))
          .limit(20),
      ]);

      const appointmentsView = apptRows.map((a) => appointmentView(a, decrypted.full_name));

      const timeline = [
        ...encRows.map((e) => ({
          kind: "encounter" as const,
          at: e.startedAt.toISOString(),
          label: `Encounter · ${e.encounterType}${e.chiefConcern ? ` — ${e.chiefConcern}` : ""}`,
        })),
        ...apptRows.map((a) => ({
          kind: "appointment" as const,
          at: a.scheduledStart.toISOString(),
          label: `Appointment · ${a.status}`,
        })),
      ]
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 20);

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
        consent_active: null,
        current_concern: latestEncounter[0]?.chiefConcern ?? null,
        relationships: [],
        appointments: appointmentsView,
        timeline,
      };
    },
  );
}
