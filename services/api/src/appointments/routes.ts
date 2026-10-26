import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, isNull, or } from "drizzle-orm";
import {
  bookAppointmentSchema,
  completeConsultationSchema,
  noteSectionsSchema,
  paymentStatusUpdateSchema,
  scheduleDateSchema,
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
import { computeSlots } from "../availability/slots.js";
import { appointmentView, patientNames } from "./map.js";

type BookingResult = { status: number; code: string; message: string } | { appointment: typeof appointments.$inferSelect; created: boolean };

/** Registers booking and appointment transitions without implying record-sharing consent. */
export async function appointmentRoutes(app: FastifyInstance) {
  app.post("/patients/self/appointments", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    const parsed = bookAppointmentSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid appointment payload");
    const raw = request.body as Record<string, unknown>;
    if ("consent_id" in raw || "packet_id" in raw || "packetId" in raw) return error(request, reply, 409, "CONSENT_UNAVAILABLE", "Scoped packet sharing is not supported. No booking or sharing was created.");
    const body = parsed.data;
    const start = new Date(body.scheduled_start);
    if (!Number.isFinite(start.getTime())) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid scheduled_start");
    const database = requireDb();
    const result: BookingResult = await database.transaction(async (tx): Promise<BookingResult> => {
      // All patient booking attempts for this doctor serialize before checking capacity.
      const [doctor] = await tx.select({ id: doctors.id }).from(doctors).where(eq(doctors.id, body.doctor_id)).for("update");
      if (!doctor) return { status: 404, code: "NOT_FOUND", message: "Doctor not found" } as const;
      if (body.encounter_id) {
        const [enc] = await tx.select({ id: encounters.id }).from(encounters)
          .where(and(eq(encounters.id, body.encounter_id), eq(encounters.patientId, patientId))).limit(1);
        if (!enc) return { status: 404, code: "NOT_FOUND", message: "Encounter not found" } as const;
      }
      const [existing] = await tx.select().from(appointments).where(and(
        eq(appointments.patientId, patientId), eq(appointments.doctorId, body.doctor_id),
        eq(appointments.scheduledStart, start), inArray(appointments.status, ["REQUESTED", "CONFIRMED"]),
      )).limit(1);
      if (existing) {
        if (existing.appointmentType !== body.appointment_type || (existing.reason ?? "") !== (body.reason?.trim() ?? "") || (existing.encounterId ?? null) !== (body.encounter_id ?? null)) {
          return { status: 409, code: "BOOKING_EXISTS", message: "You already have a different booking at this time. Review it in Appointments." } as const;
        }
        return { appointment: existing, created: false };
      }
      if (start.getTime() <= Date.now()) return { status: 400, code: "SLOT_EXPIRED", message: "Choose a future appointment time" } as const;
      const [availability] = await tx.select().from(doctorAvailability).where(eq(doctorAvailability.doctorId, body.doctor_id)).limit(1);
      if (!availability) return { status: 409, code: "SLOT_UNAVAILABLE", message: "This doctor has no published availability" } as const;
      const end = new Date(start.getTime() + availability.slotDurationMinutes * 60000);
      const overlaps = await tx.select().from(appointments).where(and(
        eq(appointments.doctorId, body.doctor_id), inArray(appointments.status, ["REQUESTED", "CONFIRMED"]),
        lt(appointments.scheduledStart, end), or(gt(appointments.scheduledEnd, start), isNull(appointments.scheduledEnd)),
      ));
      const slots = computeSlots(availability.weeklyTemplate, availability.slotDurationMinutes, start, end,
        overlaps.map((a) => ({ start: a.scheduledStart, end: a.scheduledEnd ?? new Date(a.scheduledStart.getTime() + availability.slotDurationMinutes * 60000) })), { rules: availability.rules, appointmentType: body.appointment_type });
      if (!slots.some((slot) => slot.start.getTime() === start.getTime())) return { status: 409, code: "SLOT_TAKEN", message: "This time is not available. Choose another slot." } as const;
      const [appointment] = await tx.insert(appointments).values({ patientId, doctorId: body.doctor_id,
        encounterId: body.encounter_id ?? null, appointmentType: body.appointment_type, status: "REQUESTED",
        scheduledStart: start, scheduledEnd: end, reason: body.reason?.trim() || null, paymentStatus: "UNPAID",
      }).returning();
      return { appointment, created: true };
    });
    if ("code" in result) return error(request, reply, result.status, result.code, result.message);
    const names = await patientNames([patientId]);
    return reply.code(result.created ? 201 : 200).send({ appointment: appointmentView(result.appointment, names.get(patientId) ?? "") });
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
    if ([from, to].some((date) => date && (!Number.isFinite(new Date(date).getTime()) || (/^\d{4}-\d{2}-\d{2}$/.test(date) && !scheduleDateSchema.safeParse(date).success))) || (from && to && from > to)) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Choose a valid schedule range");
    }
    const database = requireDb();
    const rows = await database
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.doctorId, doctorId),
          ...(from ? [gte(appointments.scheduledStart, new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00+05:30` : from))] : []),
          ...(to
            ? [lte(appointments.scheduledStart, /^\d{4}-\d{2}-\d{2}$/.test(to) ? new Date(`${to}T23:59:59.999+05:30`) : new Date(to))]
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

      const result = await requireDb().transaction(async (tx) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, request.params.appointment_id)).for("update");
        if (!appt) return "NOT_FOUND";
        if (appt.doctorId !== doctorId) return "FORBIDDEN";
        if (appt.status === "CONFIRMED") return null;
        if (appt.status !== "REQUESTED") return "APPOINTMENT_CLOSED";
        await tx.update(appointments).set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(appointments.id, appt.id));
        return null;
      });
      if (result) return error(request, reply, result === "NOT_FOUND" ? 404 : result === "FORBIDDEN" ? 403 : 409, result, "This appointment cannot be confirmed");
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
        const [current] = await tx.select().from(appointments).where(eq(appointments.id, appt.id)).for("update");
        if (!current || (current.status !== "CONFIRMED" && current.status !== "COMPLETED")) return "APPOINTMENT_CLOSED";
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
      if (result === "APPOINTMENT_CLOSED") return error(request, reply, 409, result, "Cancelled or unconfirmed appointments cannot be completed");
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
      const result = await requireDb().transaction(async (tx) => {
        const [appt] = await tx.select().from(appointments).where(eq(appointments.id, request.params.appointment_id)).for("update");
        if (!appt) return "NOT_FOUND";
        const owner = request.auth.role === "PATIENT" && request.auth.patientId === appt.patientId;
        const doctor = request.auth.role === "DOCTOR" && request.auth.doctorId === appt.doctorId;
        if (!owner && !doctor) return "FORBIDDEN";
        if (appt.status === "CANCELLED") return null;
        if (appt.status !== "REQUESTED" && appt.status !== "CONFIRMED") return "APPOINTMENT_CLOSED";
        await tx.update(appointments).set({ status: "CANCELLED", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(appointments.id, appt.id));
        return null;
      });
      if (result) return error(request, reply, result === "NOT_FOUND" ? 404 : result === "FORBIDDEN" ? 403 : 409, result,
        result === "APPOINTMENT_CLOSED" ? "Completed and closed appointments cannot be cancelled" : "Appointment not found or unauthorized");
      return { ok: true };
    },
  );
}
