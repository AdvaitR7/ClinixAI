import type { FastifyInstance } from "fastify";
import { and, desc, eq } from "drizzle-orm";
import {
  doctorBookAppointmentSchema,
  doctorCreateEncounterSchema,
  noteAmendSchema,
  noteSectionsSchema,
  type NoteSections,
} from "@clinix/schemas";
import { authorizePatientAccess, requireDoctor } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  appointments,
  consultationNotes,
  doctorAvailability,
  encounters,
} from "../schema.js";
import { appointmentView, patientNames } from "../appointments/map.js";
import { medicationsForPatient } from "../medications/derive.js";

const NOTE_CONSULTATION = "CONSULTATION";
const NOTE_AMENDMENT = "CONSULTATION_AMENDMENT";

/** Parses stored note sections, returning null when their JSON is malformed. */
function parseSections(content: string | null): NoteSections | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as NoteSections;
  } catch {
    return null;
  }
}

/** Doctor books on behalf of a walk-in/unclaimed patient (contract extension). */
export async function consultationRoutes(app: FastifyInstance) {
  app.post("/doctor/appointments", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const parsed = doctorBookAppointmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid appointment payload");
    }
    const body = parsed.data;

    const allowed = await authorizePatientAccess(request.auth, body.patient_id);
    if (!allowed) {
      return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient");
    }

    const database = requireDb();
    const start = new Date(body.scheduled_start);
    if (Number.isNaN(start.getTime())) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid scheduled_start");
    }

    const avail = await database
      .select({ slotDurationMinutes: doctorAvailability.slotDurationMinutes })
      .from(doctorAvailability)
      .where(eq(doctorAvailability.doctorId, doctorId))
      .limit(1);
    const minutes = avail[0]?.slotDurationMinutes ?? 30;
    const end = new Date(start.getTime() + minutes * 60 * 1000);

    // Overlap guard: exact-start check (ponytail — same as the patient booking
    // guard in appointments/routes.ts; add an exclusion constraint if it ever matters).
    const overlap = await database
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          eq(appointments.scheduledStart, start),
        ),
      )
      .limit(1);
    if (overlap.length > 0) {
      return error(request, reply, 409, "SLOT_TAKEN", "This time slot is no longer available");
    }

    const inserted = await database
      .insert(appointments)
      .values({
        patientId: body.patient_id,
        doctorId,
        appointmentType: body.appointment_type,
        status: "CONFIRMED",
        scheduledStart: start,
        scheduledEnd: end,
        reason: body.reason ?? null,
        paymentStatus: "UNPAID",
        confirmedAt: new Date(),
      })
      .returning();

    const names = await patientNames([body.patient_id]);
    return reply
      .code(201)
      .send({ appointment: appointmentView(inserted[0], names.get(body.patient_id) ?? "") });
  });

  app.post("/doctor/encounters", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const parsed = doctorCreateEncounterSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid encounter payload");
    }
    const body = parsed.data;

    const allowed = await authorizePatientAccess(request.auth, body.patient_id);
    if (!allowed) {
      return error(request, reply, 403, "FORBIDDEN", "Not authorized for this patient");
    }

    const database = requireDb();

    if (body.appointment_id) {
      const appt = (
        await database
          .select()
          .from(appointments)
          .where(eq(appointments.id, body.appointment_id))
          .limit(1)
      )[0];
      if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
      if (appt.doctorId !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your appointment");
      }
      // Find-or-create: a repeat call returns the already-linked encounter.
      if (appt.encounterId) {
        return reply.send({ encounter_id: appt.encounterId });
      }
      const enc = await database
        .insert(encounters)
        .values({
          patientId: body.patient_id,
          encounterType: body.encounter_type ?? "DOCTOR_IN_PERSON",
          status: "OPEN",
          chiefConcern: body.chief_concern ?? null,
          initiatedByActorType: "DOCTOR",
          initiatedByActorId: doctorId,
          relatedDoctorId: doctorId,
        })
        .returning({ id: encounters.id });
      await database
        .update(appointments)
        .set({ encounterId: enc[0].id, updatedAt: new Date() })
        .where(eq(appointments.id, appt.id));
      return reply.code(201).send({ encounter_id: enc[0].id });
    }

    const enc = await database
      .insert(encounters)
      .values({
        patientId: body.patient_id,
        encounterType: body.encounter_type ?? "DOCTOR_IN_PERSON",
        status: "OPEN",
        chiefConcern: body.chief_concern ?? null,
        initiatedByActorType: "DOCTOR",
        initiatedByActorId: doctorId,
        relatedDoctorId: doctorId,
      })
      .returning({ id: encounters.id });
    return reply.code(201).send({ encounter_id: enc[0].id });
  });

  app.get<{ Params: { appointment_id: string } }>(
    "/doctor/appointments/:appointment_id/consultation",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const database = requireDb();
      const appt = (
        await database
          .select()
          .from(appointments)
          .where(eq(appointments.id, request.params.appointment_id))
          .limit(1)
      )[0];
      if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
      if (appt.doctorId !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your appointment");
      }

      if (!["CONFIRMED", "COMPLETED"].includes(appt.status) || (appt.status === "COMPLETED" && !appt.encounterId)) {
        return error(request, reply, 409, "APPOINTMENT_CLOSED", "This appointment cannot start a consultation");
      }

      // Ensure an encounter exists (self-contained: Page 18 may call this first).
      let encounterId = appt.encounterId;
      if (!encounterId) {
        const enc = await database
          .insert(encounters)
          .values({
            patientId: appt.patientId,
            encounterType: appt.appointmentType === "ONLINE" ? "DOCTOR_ONLINE" : "DOCTOR_IN_PERSON",
            status: "OPEN",
            initiatedByActorType: "DOCTOR",
            initiatedByActorId: doctorId,
            relatedDoctorId: doctorId,
          })
          .returning({ id: encounters.id });
        encounterId = enc[0].id;
        await database
          .update(appointments)
          .set({ encounterId, updatedAt: new Date() })
          .where(eq(appointments.id, appt.id));
      }

      const note = (
        await database
          .select()
          .from(consultationNotes)
          .where(
            and(
              eq(consultationNotes.encounterId, encounterId),
              eq(consultationNotes.noteType, NOTE_CONSULTATION),
            ),
          )
          .orderBy(desc(consultationNotes.createdAt))
          .limit(1)
      )[0];

      const names = await patientNames([appt.patientId]);
      const currentMedications = await medicationsForPatient(appt.patientId, doctorId);
      const amendments = await database.select().from(consultationNotes).where(and(
        eq(consultationNotes.encounterId, encounterId),
        eq(consultationNotes.noteType, NOTE_AMENDMENT),
      )).orderBy(desc(consultationNotes.createdAt));

      return {
        appointment: appointmentView(appt, names.get(appt.patientId) ?? ""),
        encounter_id: encounterId,
        note: parseSections(note?.content ?? null),
        note_is_final: note?.isFinal ?? false,
        note_amendments: amendments.map((amendment) => {
          const parsed = noteAmendSchema.safeParse(JSON.parse(amendment.content ?? "{}"));
          return {
            id: amendment.id,
            doctor_id: amendment.doctorId,
            created_at: amendment.createdAt.toISOString(),
            reason: parsed.success ? parsed.data.reason : "Amendment content unavailable",
            sections: parsed.success ? noteSectionsSchema.parse(parsed.data) : {},
          };
        }),
        allergies: [],
        current_medications: currentMedications,
      };
    },
  );

  app.put<{ Params: { encounter_id: string } }>(
    "/doctor/encounters/:encounter_id/note",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = noteSectionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid note payload");
      }

      const database = requireDb();
      const enc = (
        await database
          .select()
          .from(encounters)
          .where(eq(encounters.id, request.params.encounter_id))
          .limit(1)
      )[0];
      if (!enc) return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
      const allowed = await authorizePatientAccess(request.auth, enc.patientId);
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this encounter");
      }

      const result = await database.transaction(async (tx) => {
        await tx.select().from(encounters).where(eq(encounters.id, enc.id)).for("update");
        const note = (
          await tx
            .select()
            .from(consultationNotes)
            .where(
              and(
                eq(consultationNotes.encounterId, enc.id),
                eq(consultationNotes.noteType, NOTE_CONSULTATION),
              ),
            )
            .limit(1)
        )[0];

        if (note?.isFinal) {
          return "NOTE_FINALIZED";
        }

        const content = JSON.stringify(parsed.data);
        if (note) {
          await tx
            .update(consultationNotes)
            .set({ content, updatedAt: new Date() })
            .where(eq(consultationNotes.id, note.id));
        } else {
          await tx.insert(consultationNotes).values({
            patientId: enc.patientId,
            encounterId: enc.id,
            doctorId,
            noteType: NOTE_CONSULTATION,
            content,
          });
        }
        return null;
      });
      if (result) return error(request, reply, 409, result, "Finalized notes use amendments, not edits");
      return { ok: true };
    },
  );

  app.post<{ Params: { encounter_id: string } }>(
    "/doctor/encounters/:encounter_id/note/amend",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = noteAmendSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid amend payload");
      }
      const { reason, ...sections } = parsed.data;

      const database = requireDb();
      const enc = (
        await database
          .select()
          .from(encounters)
          .where(eq(encounters.id, request.params.encounter_id))
          .limit(1)
      )[0];
      if (!enc) return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
      const allowed = await authorizePatientAccess(request.auth, enc.patientId);
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this encounter");
      }

      const amended = await database.transaction(async (tx) => {
        await tx.select().from(encounters).where(eq(encounters.id, enc.id)).for("update");
        const [original] = await tx.select().from(consultationNotes).where(and(
          eq(consultationNotes.encounterId, enc.id),
          eq(consultationNotes.noteType, NOTE_CONSULTATION),
        )).limit(1);
        if (!original?.isFinal) return false;
        await tx.insert(consultationNotes).values({
          patientId: enc.patientId,
          encounterId: enc.id,
          doctorId,
          noteType: NOTE_AMENDMENT,
          content: JSON.stringify({ reason, ...sections }),
          isFinal: true,
          finalizedAt: new Date(),
        });
        return true;
      });
      if (!amended) return error(request, reply, 409, "NOTE_NOT_FINAL", "Save draft changes directly until the note is finalized");
      return reply.code(201).send({ ok: true });
    },
  );
}
