import type { FastifyInstance } from "fastify";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { availabilityQuerySchema, availabilityRulesSchema, doctorAvailabilitySchema, scheduleDateSchema } from "@clinix/schemas";
import { requireDoctor } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import { appointments, doctorAvailability, doctors } from "../schema.js";
import { computeSlots } from "./slots.js";

/** GET /doctors/{doctor_id}/availability — selectable slots (API spec §14). */
export async function availabilityRoutes(app: FastifyInstance) {
  // Published slots cannot reconstruct working windows or exceptions: expose an authenticated own settings read.
  app.get("/doctors/self/availability", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const [row] = await requireDb().select().from(doctorAvailability).where(eq(doctorAvailability.doctorId, doctorId)).limit(1);
    return { configured: !!row, template: row?.weeklyTemplate ?? [], slot_duration_minutes: row?.slotDurationMinutes ?? 30, rules: row?.rules ?? availabilityRulesSchema.parse({}) };
  });
  app.get<{ Params: { doctor_id: string } }>(
    "/doctors/:doctor_id/availability",
    async (request, reply) => {
      const database = requireDb();

      const parsed = availabilityQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "from/to query params required");
      }
      const { from, to, type } = parsed.data;

      // Date-only ranges ("YYYY-MM-DD") mean the full day; expand `to` to end-of-day.
      const fromDate = new Date(/^\d{4}-\d{2}-\d{2}$/.test(from) ? `${from}T00:00:00+05:30` : from);
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(to)
        ? new Date(`${to}T23:59:59.999+05:30`)
        : new Date(to);

      if ([from, to].some((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && !scheduleDateSchema.safeParse(date).success) || !Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime()) || fromDate > toDate || toDate.getTime() - fromDate.getTime() > 366 * 86400000) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Choose a valid availability range of at most one year");
      }
      const [availRows, bookedRows] = await Promise.all([
        database
          .select()
          .from(doctorAvailability)
          .where(eq(doctorAvailability.doctorId, request.params.doctor_id))
          .limit(1),
        database
          .select({ scheduledStart: appointments.scheduledStart, scheduledEnd: appointments.scheduledEnd })
          .from(appointments)
          .where(
            and(
              eq(appointments.doctorId, request.params.doctor_id),
              inArray(appointments.status, ["REQUESTED", "CONFIRMED"]),
              gte(appointments.scheduledStart, new Date(fromDate.getTime() - 86400000)),
              lte(appointments.scheduledStart, toDate),
            ),
          ),
      ]);

      const avail = availRows[0];
      if (!avail) return { slots: [] };

      const slotMinutes = avail.slotDurationMinutes;
      const booked = bookedRows.map((b) => ({
        start: b.scheduledStart,
        end: b.scheduledEnd ?? new Date(b.scheduledStart.getTime() + slotMinutes * 60 * 1000),
      }));

      const slots = computeSlots(
        avail.weeklyTemplate,
        slotMinutes,
        fromDate,
        toDate,
        booked,
        { rules: avail.rules, appointmentType: type },
      );

      return {
        slots: slots.filter((s) => s.start.getTime() > Date.now()).map((s) => ({
          start: s.start.toISOString(),
          end: s.end.toISOString(),
        })),
      };
    },
  );

  app.put("/doctors/self/availability", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const parsed = doctorAvailabilitySchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid availability payload");
    }
    const body = parsed.data;
    const database = requireDb();

    await database.transaction(async (tx) => {
      // Use the same lock as patient booking so capacity is checked against one published settings state.
      await tx.select({ id: doctors.id }).from(doctors).where(eq(doctors.id, doctorId)).for("update");
      const changes = {
        weeklyTemplate: body.template,
        slotDurationMinutes: body.slot_duration_minutes ?? 30,
        ...(body.rules !== undefined ? { rules: body.rules } : {}),
        updatedAt: new Date(),
      };
      await tx.insert(doctorAvailability).values({ doctorId, ...changes })
        .onConflictDoUpdate({ target: doctorAvailability.doctorId, set: changes });
    });

    return { ok: true };
  });
}
