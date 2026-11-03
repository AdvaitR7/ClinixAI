import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { paymentStatusUpdateSchema, staffBookAppointmentSchema } from "@clinix/schemas";
import { requirePracticeRole } from "../auth/guards.js";
import { patientNames, appointmentView } from "../appointments/map.js";
import { logAccess } from "../audit/log.js";
import { hashIdentity } from "../crypto.js";
import { error, requireDb } from "../http.js";
import { practiceDoctorIds } from "../practices/scope.js";
import {
  appointments,
  doctorAvailability,
  doctorProfiles,
  doctors,
  patientClaimInvites,
  patientDoctorRelationships,
  patients,
  paymentEvents,
  profiles,
  recordRemovalRequests,
} from "../schema.js";

const STAFF_ROLES = ["RECEPTION", "ASSISTANT"] as const;
const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Patient ids the practice already serves: appointments with its doctors, or an active
 * care relationship with one of them (so a patient staff just registered is bookable).
 */
async function practicePatientIds(practiceId: string): Promise<{ doctorIds: string[]; patientIds: Set<string> }> {
  const doctorIds = await practiceDoctorIds(practiceId);
  if (doctorIds.length === 0) return { doctorIds, patientIds: new Set() };
  const rows = await requireDb()
    .select({ patientId: appointments.patientId })
    .from(appointments)
    .where(or(eq(appointments.practiceId, practiceId), inArray(appointments.doctorId, doctorIds)));
  const related = await requireDb()
    .select({ patientId: patientDoctorRelationships.patientId })
    .from(patientDoctorRelationships)
    .where(and(inArray(patientDoctorRelationships.doctorId, doctorIds), eq(patientDoctorRelationships.status, "ACTIVE")));
  return { doctorIds, patientIds: new Set([...rows, ...related].map((r) => r.patientId)) };
}

/** Staff operations beyond intake: booking, manual payment, claim invitations, request routing (Pages 23d–23f, 26). */
export async function staffOperationsRoutes(app: FastifyInstance) {
  /** Doctors a staff member may book with (the practice's own doctors). */
  app.get<{ Querystring: { practice_id?: string } }>("/staff/doctors", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const ids = member.assignedDoctorId ? [member.assignedDoctorId] : await practiceDoctorIds(member.practiceId);
    if (ids.length === 0) return [];
    const rows = await requireDb()
      .select({ id: doctors.id, name: profiles.displayName, speciality: doctors.speciality })
      .from(doctors)
      .innerJoin(profiles, eq(profiles.id, doctors.profileId))
      .where(inArray(doctors.id, ids));
    return rows.map((d) => ({ doctor_id: d.id, name: d.name, speciality: d.speciality }));
  });

  /** Staff books for a patient the practice already serves, with a practice doctor. Grants no record access. */
  app.post<{ Querystring: { practice_id?: string } }>("/staff/appointments", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const parsed = staffBookAppointmentSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid appointment payload");
    const body = parsed.data;
    const { doctorIds, patientIds } = await practicePatientIds(member.practiceId);
    if (!doctorIds.includes(body.doctor_id) || (member.assignedDoctorId && member.assignedDoctorId !== body.doctor_id)) {
      return error(request, reply, 403, "FORBIDDEN", "Doctor is not in your practice");
    }
    if (!patientIds.has(body.patient_id)) return error(request, reply, 404, "NOT_FOUND", "Patient not found in this practice");
    const database = requireDb();
    const start = new Date(body.scheduled_start);
    const [avail] = await database.select({ m: doctorAvailability.slotDurationMinutes }).from(doctorAvailability).where(eq(doctorAvailability.doctorId, body.doctor_id)).limit(1);
    const end = new Date(start.getTime() + (avail?.m ?? 30) * 60 * 1000);
    const [taken] = await database
      .select({ id: appointments.id })
      .from(appointments)
      .where(and(eq(appointments.doctorId, body.doctor_id), eq(appointments.scheduledStart, start), inArray(appointments.status, ["REQUESTED", "CONFIRMED"])))
      .limit(1);
    if (taken) return error(request, reply, 409, "SLOT_TAKEN", "This time slot is no longer available");
    const [row] = await database
      .insert(appointments)
      .values({
        patientId: body.patient_id,
        doctorId: body.doctor_id,
        practiceId: member.practiceId,
        appointmentType: body.appointment_type,
        status: "REQUESTED",
        scheduledStart: start,
        scheduledEnd: end,
        reason: body.reason ?? null,
        paymentStatus: "UNPAID",
      })
      .returning();
    const names = await patientNames([body.patient_id]);
    return reply.code(201).send({ appointment: appointmentView(row!, names.get(body.patient_id) ?? "") });
  });

  /** Loads an appointment inside the staff member's practice scope. */
  async function scoped(practiceId: string, assignedDoctorId: string | null, id: string) {
    const doctorIds = await practiceDoctorIds(practiceId);
    const [row] = await requireDb().select().from(appointments).where(eq(appointments.id, id)).limit(1);
    if (!row) return null;
    if (row.practiceId !== practiceId && !doctorIds.includes(row.doctorId)) return null;
    if (assignedDoctorId && row.doctorId !== assignedDoctorId) return null;
    return row;
  }

  /** Staff confirm a requested appointment (operational scheduling, not a clinical act). */
  app.post<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/confirm", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const appt = await scoped(member.practiceId, member.assignedDoctorId, request.params.id);
    if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    if (appt.status === "CONFIRMED") return { appointment_id: appt.id, status: "CONFIRMED" };
    if (appt.status !== "REQUESTED") return error(request, reply, 409, "APPOINTMENT_CLOSED", "This appointment cannot be confirmed");
    await requireDb().update(appointments).set({ status: "CONFIRMED", confirmedAt: new Date(), updatedAt: new Date() }).where(eq(appointments.id, appt.id));
    return { appointment_id: appt.id, status: "CONFIRMED" };
  });

  /** Staff record a manual payment status; each change keeps an audit event. */
  app.post<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/payment-status", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const parsed = paymentStatusUpdateSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid payment payload");
    const appt = await scoped(member.practiceId, member.assignedDoctorId, request.params.id);
    if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const database = requireDb();
    await database.transaction(async (tx) => {
      await tx.insert(paymentEvents).values({
        appointmentId: appt.id,
        oldStatus: appt.paymentStatus,
        newStatus: parsed.data.payment_status,
        markedByProfileId: request.auth.profileId,
        referenceNote: parsed.data.reference_note ?? null,
      });
      await tx.update(appointments).set({ paymentStatus: parsed.data.payment_status, updatedAt: new Date() }).where(eq(appointments.id, appt.id));
    });
    return { appointment_id: appt.id, payment_status: parsed.data.payment_status };
  });

  /** Operational receipt: payment status, fee (from the doctor's published service) and change history. No clinical content. */
  app.get<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/receipt", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const appt = await scoped(member.practiceId, member.assignedDoctorId, request.params.id);
    if (!appt) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const database = requireDb();
    const events = await database
      .select({ e: paymentEvents, by: profiles.displayName })
      .from(paymentEvents)
      .innerJoin(profiles, eq(profiles.id, paymentEvents.markedByProfileId))
      .where(eq(paymentEvents.appointmentId, appt.id))
      .orderBy(desc(paymentEvents.createdAt));
    const [dp] = await database.select({ services: doctorProfiles.services }).from(doctorProfiles).where(eq(doctorProfiles.doctorId, appt.doctorId)).limit(1);
    const mode = appt.appointmentType === "ONLINE" ? "ONLINE" : "IN_CLINIC";
    const service = (Array.isArray(dp?.services) ? (dp!.services as { mode: string; fee_inr: number }[]) : []).find((s) => s.mode === mode);
    const names = await patientNames([appt.patientId]);
    await logAccess(request, { patientId: appt.patientId, purpose: "Clinic payment receipt", resourceType: "payment_receipt", resourceId: appt.id, action: "READ" });
    return {
      appointment_id: appt.id,
      patient_name: names.get(appt.patientId) ?? "",
      scheduled_start: appt.scheduledStart.toISOString(),
      payment_status: appt.paymentStatus,
      fee_inr: service?.fee_inr ?? null,
      events: events.map(({ e, by }) => ({ old_status: e.oldStatus, new_status: e.newStatus, by, note: e.referenceNote, at: e.createdAt.toISOString() })),
    };
  });

  /** Unclaimed patients of this practice and the state of their claim invitation. Contact and resend only. */
  app.get<{ Querystring: { practice_id?: string } }>("/staff/claim-invitations", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const { patientIds } = await practicePatientIds(member.practiceId);
    const ids = [...patientIds];
    if (ids.length === 0) return [];
    const database = requireDb();
    const unclaimed = await database.select({ id: patients.id }).from(patients).where(and(inArray(patients.id, ids), eq(patients.status, "UNCLAIMED")));
    if (unclaimed.length === 0) return [];
    const invites = await database
      .select()
      .from(patientClaimInvites)
      .where(inArray(patientClaimInvites.patientId, unclaimed.map((u) => u.id)))
      .orderBy(desc(patientClaimInvites.createdAt));
    const names = await patientNames(unclaimed.map((u) => u.id));
    return unclaimed.map((u) => {
      const last = invites.find((i) => i.patientId === u.id);
      const state = !last ? "NONE" : last.usedAt ? "USED" : last.expiresAt.getTime() < Date.now() ? "EXPIRED" : "OPEN";
      return { patient_id: u.id, patient_name: names.get(u.id) ?? "", invited_at: last?.createdAt.toISOString() ?? null, state };
    });
  });

  /** Issues a fresh claim invitation for an unclaimed patient of this practice. The token is shown once. */
  app.post<{ Params: { patientId: string }; Querystring: { practice_id?: string } }>("/staff/patients/:patientId/claim-invites", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES], request.query.practice_id);
    if ("statusCode" in member) return member;
    const { patientIds } = await practicePatientIds(member.practiceId);
    if (!patientIds.has(request.params.patientId)) return error(request, reply, 404, "NOT_FOUND", "Patient not found in this practice");
    const database = requireDb();
    const [patient] = await database.select().from(patients).where(eq(patients.id, request.params.patientId)).limit(1);
    if (!patient) return error(request, reply, 404, "NOT_FOUND", "Patient not found");
    if (patient.status !== "UNCLAIMED") return error(request, reply, 409, "PATIENT_CLAIMED", "This record is already claimed");
    const token = randomBytes(12).toString("hex");
    const expiresAt = new Date(Date.now() + CLAIM_TTL_MS);
    await database.insert(patientClaimInvites).values({ patientId: patient.id, inviteTokenHash: hashIdentity(token), createdByProfileId: request.auth.profileId, expiresAt, status: "OPEN" });
    return reply.code(201).send({ invite_token: token, expires_at: expiresAt.toISOString() });
  });

  /** Removal/retention requests held by this practice's doctors, for routing only. No reasons or record content. */
  app.get<{ Querystring: { practice_id?: string } }>("/staff/record-removal-requests", async (request, reply) => {
    const member = requirePracticeRole(request, reply, [...STAFF_ROLES, "OWNER"], request.query.practice_id);
    if ("statusCode" in member) return member;
    const doctorIds = await practiceDoctorIds(member.practiceId);
    if (doctorIds.length === 0) return [];
    const database = requireDb();
    const rows = await database
      .select()
      .from(recordRemovalRequests)
      .where(and(inArray(recordRemovalRequests.targetActorId, doctorIds), inArray(recordRemovalRequests.status, ["OPEN", "ROUTED"])))
      .orderBy(desc(recordRemovalRequests.requestedAt));
    const dnames = await database.select({ id: doctors.id, name: profiles.displayName }).from(doctors).innerJoin(profiles, eq(profiles.id, doctors.profileId)).where(inArray(doctors.id, doctorIds));
    return rows.map((r) => ({
      id: r.id,
      resource_type: r.resourceType,
      status: r.status,
      requested_at: r.requestedAt.toISOString(),
      target_doctor_id: r.targetActorId,
      target_doctor_name: dnames.find((d) => d.id === r.targetActorId)?.name ?? null,
    }));
  });
}
