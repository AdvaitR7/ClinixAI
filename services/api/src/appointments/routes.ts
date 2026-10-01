import type { FastifyInstance } from "fastify";
import { and, asc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import {
  bookAppointmentSchema,
  paymentStatusUpdateSchema,
} from "@clinix/schemas";
import { requireDoctor, requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  appointments,
  doctorAvailability,
  doctors,
  encounters,
  paymentEvents,
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
          ...(to ? [lte(appointments.scheduledStart, new Date(to))] : []),
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

      await database
        .update(appointments)
        .set({ status: "COMPLETED", completedAt: new Date(), updatedAt: new Date() })
        .where(eq(appointments.id, appt.id));
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
