import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import {
  bookAppointmentSchema,
  completeConsultationSchema,
  noteSectionsSchema,
  paymentStatusUpdateSchema,
} from "@clinix/schemas";
import { requireDoctor, requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  appointments,
  consultationNotes,
  doctorAvailability,
  doctors,
  encounters,
  paymentEvents,
  profiles,
} from "../schema.js";
import { appointmentView, patientNames } from "./map.js";

async function slotMinutes(doctorId: string): Promise<number> {
  const database = requireDb();
  const rows = await database
    .select({ slotDurationMinutes: doctorAvailability.slotDurationMinutes })
    .from(doctorAvailability)
    .where(eq(doctorAvailability.doctorId, doctorId))
    .limit(1);
  return rows[0]?.slotDurationMinutes ?? 30;
}

export async function appointmentRoutes(app: FastifyInstance) {
  app.post("/patients/self/appointments", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const parsed = bookAppointmentSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid appointment payload");
    }
    const body = parsed.data;
    const database = requireDb();

    const start = new Date(body.scheduled_start);
    if (Number.isNaN(start.getTime())) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid scheduled_start");
    }

    const doctor = await database
      .select({ id: doctors.id })
      .from(doctors)
      .where(eq(doctors.id, body.doctor_id))
      .limit(1);
    if (doctor.length === 0) {
      return error(request, reply, 404, "NOT_FOUND", "Doctor not found");
    }

    if (body.encounter_id) {
      const enc = await database
        .select({ id: encounters.id })
        .from(encounters)
        .where(
          and(
            eq(encounters.id, body.encounter_id),
            eq(encounters.patientId, patientId),
          ),
        )
        .limit(1);
      if (enc.length === 0) {
        return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
      }
    }

    const minutes = await slotMinutes(body.doctor_id);
    const end = new Date(start.getTime() + minutes * 60 * 1000);

    // Idempotency: same (patient, doctor, start) non-cancelled → return existing.
    const existing = await database
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.patientId, patientId),
          eq(appointments.doctorId, body.doctor_id),
          eq(appointments.scheduledStart, start),
          ne(appointments.status, "CANCELLED"),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      const names = await patientNames([patientId]);
      return { appointment: appointmentView(existing[0], names.get(patientId) ?? "") };
    }

    // Overlap guard: another non-cancelled booking at the same slot start.
    // ponytail: exact-start check, not full range overlap; add an exclusion
    // constraint if concurrent double-booking ever matters.
    const overlap = await database
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, body.doctor_id),
          eq(appointments.scheduledStart, start),
          inArray(appointments.status, ["REQUESTED", "CONFIRMED"]),
        ),
      )
      .limit(1);
    if (overlap.length > 0) {
      return error(request, reply, 409, "SLOT_TAKEN", "This time slot is no longer available");
    }

    const inserted = await database
      .insert(appointments)
      .values({
        patientId,
        doctorId: body.doctor_id,
        encounterId: body.encounter_id ?? null,
        appointmentType: body.appointment_type,
        status: "REQUESTED",
        scheduledStart: start,
        scheduledEnd: end,
        reason: body.reason ?? null,
        paymentStatus: "UNPAID",
      })
      .returning();

    const names = await patientNames([patientId]);
    return reply
      .code(201)
      .send({ appointment: appointmentView(inserted[0], names.get(patientId) ?? "") });
  });

  app.get("/patients/self/appointments", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const database = requireDb();
    const rows = await database
      .select()
      .from(appointments)
      .where(eq(appointments.patientId, patientId))
      .orderBy(desc(appointments.scheduledStart));

    const doctorIds = [...new Set(rows.map((r) => r.doctorId))];
    const drRows = doctorIds.length
      ? await database
          .select({
            id: doctors.id,
            name: profiles.displayName,
            speciality: doctors.speciality,
          })
          .from(doctors)
          .innerJoin(profiles, eq(profiles.id, doctors.profileId))
          .where(inArray(doctors.id, doctorIds))
      : [];
    const doctorById = new Map(drRows.map((r) => [r.id, r]));

    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      appointment_type: r.appointmentType,
      scheduled_start: r.scheduledStart.toISOString(),
      scheduled_end: r.scheduledEnd ? r.scheduledEnd.toISOString() : null,
      reason: r.reason,
      payment_status: r.paymentStatus,
      doctor_id: r.doctorId,
      doctor_name: doctorById.get(r.doctorId)?.name ?? "",
      speciality: doctorById.get(r.doctorId)?.speciality ?? null,
    }));
  });

  app.get("/doctor/appointments", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const { from, to } = request.query as { from?: string; to?: string };
    const database = requireDb();
    const rows = await database
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          ...(from ? [gte(appointments.scheduledStart, new Date(from))] : []),
          ...(to
            ? [lte(appointments.scheduledStart, /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999Z`) : new Date(to))]
            : []),
        ),
      )
      .orderBy(asc(appointments.scheduledStart));

    const names = await patientNames(rows.map((r) => r.patientId));
    return rows.map((r) => appointmentView(r, names.get(r.patientId) ?? ""));
  });

  app.post<{ Params: { appointment_id: string } }>(
    "/doctor/appointments/:appointment_id/confirm",
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

      await database
        .update(appointments)
        .set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(appointments.id, appt.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { appointment_id: string } }>(
    "/doctor/appointments/:appointment_id/complete",
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

      const parsed = completeConsultationSchema.safeParse(request.body ?? {});
      if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid reviewed note");
      if (!appt.encounterId) return error(request, reply, 409, "NOTE_REQUIRED", "Save a clinical note before completing");

      // Note writes take the same encounter lock, so completion cannot race an autosave.
      const result = await database.transaction(async (tx) => {
        await tx.select().from(encounters).where(eq(encounters.id, appt.encounterId!)).for("update");
        const [note] = await tx.select().from(consultationNotes).where(and(
          eq(consultationNotes.encounterId, appt.encounterId!),
          eq(consultationNotes.noteType, "CONSULTATION"),
        )).limit(1);
        if (!note) return "NOTE_REQUIRED";
        if (parsed.data.reviewed_note) {
          let content: unknown;
          try {
            content = JSON.parse(note.content ?? "{}");
          } catch {
            return "NOTE_CHANGED";
          }
          const saved = noteSectionsSchema.safeParse(content);
          const reviewed = parsed.data.reviewed_note;
          if (!saved.success || (["complaint", "observations", "assessment", "plan"] as const).some(
            (key) => (saved.data[key] ?? "") !== (reviewed[key] ?? ""),
          )) return "NOTE_CHANGED";
        }
        const now = new Date();
        await tx.update(consultationNotes)
          .set({ isFinal: true, finalizedAt: note.finalizedAt ?? now, updatedAt: now })
          .where(eq(consultationNotes.id, note.id));
        await tx.update(encounters)
          .set({ status: "COMPLETED", closedAt: now, updatedAt: now })
          .where(eq(encounters.id, appt.encounterId!));
        await tx.update(appointments)
          .set({ status: "COMPLETED", completedAt: appt.completedAt ?? now, updatedAt: now })
          .where(eq(appointments.id, appt.id));
        return null;
      });
      if (result) return error(request, reply, 409, result, result === "NOTE_REQUIRED"
        ? "Save a clinical note before completing"
        : "The note changed after review. Reload and review the latest note.");
      return { ok: true };
    },
  );

  app.post<{ Params: { appointment_id: string } }>(
    "/doctor/appointments/:appointment_id/payment-status",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = paymentStatusUpdateSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid payment payload");
      }
      const body = parsed.data;
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

      await database.insert(paymentEvents).values({
        appointmentId: appt.id,
        oldStatus: appt.paymentStatus,
        newStatus: body.payment_status,
        markedByProfileId: request.auth.profileId,
        referenceNote: body.reference_note ?? null,
      });
      await database
        .update(appointments)
        .set({ paymentStatus: body.payment_status, updatedAt: new Date() })
        .where(eq(appointments.id, appt.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { appointment_id: string } }>(
    "/appointments/:appointment_id/cancel",
    async (request, reply) => {
      const database = requireDb();
      const appt = (
        await database
          .select()
          .from(appointments)
          .where(eq(appointments.id, request.params.appointment_id))
          .limit(1)
      )[0];
      if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");

      const isDoctor = request.auth.role === "DOCTOR" && request.auth.doctorId === appt.doctorId;
      const isOwner = request.auth.role === "PATIENT" && request.auth.patientId === appt.patientId;
      if (!isDoctor && !isOwner) {
        return error(request, reply, 403, "FORBIDDEN", "Not your appointment");
      }

      await database
        .update(appointments)
        .set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(appointments.id, appt.id));
      return { ok: true };
    },
  );
}
