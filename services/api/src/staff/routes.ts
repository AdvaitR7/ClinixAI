import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { and, asc, eq, gte, inArray, lt, or } from "drizzle-orm";
import { decryptMinimal } from "../patients/identity.js";
import { intakeVitalsSchema } from "@clinix/schemas";
import { requireDoctor, requirePracticeRole } from "../auth/guards.js";
import type { PracticeMembership } from "../auth/context.js";
import { appointmentView, patientNames } from "../appointments/map.js";
import { logAccess } from "../audit/log.js";
import { error, requireDb } from "../http.js";
import { practiceDoctorIds } from "../practices/scope.js";
import {
  appointmentIntakes,
  appointments,
  followups,
  intakeVitals,
  patientIdentity,
  patients,
  practices,
  profiles,
} from "../schema.js";

type AppointmentRow = typeof appointments.$inferSelect;

/** Flags out-of-range values for doctor review. Demo-scale thresholds; never a diagnosis. */
export function vitalsNeedReview(v: {
  temperature_c?: number;
  pulse_bpm?: number;
  systolic_mmhg?: number;
  diastolic_mmhg?: number;
  spo2_percent?: number;
}): boolean {
  return (
    (v.temperature_c !== undefined && (v.temperature_c >= 38 || v.temperature_c < 35.5)) ||
    (v.pulse_bpm !== undefined && (v.pulse_bpm < 50 || v.pulse_bpm > 110)) ||
    (v.systolic_mmhg !== undefined && (v.systolic_mmhg >= 140 || v.systolic_mmhg < 90)) ||
    (v.diastolic_mmhg !== undefined && v.diastolic_mmhg >= 90) ||
    (v.spo2_percent !== undefined && v.spo2_percent < 95)
  );
}

/**
 * Loads an appointment only if it belongs to the staff member's practice
 * (practice_id match, or one of the practice's doctors) and, for assistants
 * with an assigned doctor, to that doctor.
 */
async function scopedAppointment(member: PracticeMembership, appointmentId: string): Promise<AppointmentRow | null> {
  const [row] = await requireDb().select().from(appointments).where(eq(appointments.id, appointmentId)).limit(1);
  if (!row) return null;
  const doctorIds = await practiceDoctorIds(member.practiceId);
  if (row.practiceId !== member.practiceId && !doctorIds.includes(row.doctorId)) return null;
  if (member.assignedDoctorId && row.doctorId !== member.assignedDoctorId) return null;
  return row;
}

/** Staff dashboards, arrival and intake (Pages 23, 23a, 24, 24a). Never clinical authoring. */
export async function staffRoutes(app: FastifyInstance) {
  /** Resolves a staff-operations member (receptionist or assistant) for the request's practice. */
  function staffMember(
    request: FastifyRequest<{ Querystring: { practice_id?: string } }>,
    reply: FastifyReply,
    roles: PracticeMembership["role"][] = ["RECEPTION", "ASSISTANT"],
  ) {
    return requirePracticeRole(request, reply, roles, request.query?.practice_id);
  }

  /** Practice-scoped operational dashboard for today. */
  app.get<{ Querystring: { practice_id?: string } }>("/staff/dashboard", async (request, reply) => {
    const member = staffMember(request, reply);
    if ("statusCode" in member) return member;
    const database = requireDb();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const doctorIds = await practiceDoctorIds(member.practiceId);
    const scope = member.assignedDoctorId
      ? eq(appointments.doctorId, member.assignedDoctorId)
      : or(
          eq(appointments.practiceId, member.practiceId),
          doctorIds.length ? inArray(appointments.doctorId, doctorIds) : undefined,
        );
    const rows = await database
      .select()
      .from(appointments)
      .where(and(scope, gte(appointments.scheduledStart, start), lt(appointments.scheduledStart, end)))
      .orderBy(asc(appointments.scheduledStart));
    const ids = rows.map((r) => r.id);
    const intakes = ids.length
      ? await database.select().from(appointmentIntakes).where(inArray(appointmentIntakes.appointmentId, ids))
      : [];
    const names = await patientNames(rows.map((r) => r.patientId));
    const [practice] = await database.select({ name: practices.name }).from(practices).where(eq(practices.id, member.practiceId)).limit(1);
    const tasks = await database
      .select()
      .from(followups)
      .where(and(eq(followups.assignedMemberId, member.memberId), eq(followups.status, "OPEN")))
      .orderBy(asc(followups.dueAt));
    const taskNames = await patientNames(tasks.map((t) => t.patientId));
    const view = rows.map((r) => ({
      ...appointmentView(r, names.get(r.patientId) ?? ""),
      intake_status: intakes.find((i) => i.appointmentId === r.id)?.status ?? null,
    }));
    return {
      practice: { id: member.practiceId, name: practice?.name ?? "Practice" },
      role: member.role,
      counts: {
        requested: view.filter((a) => a.status === "REQUESTED").length,
        waiting: view.filter((a) => a.intake_status === "WAITING" || a.intake_status === "ARRIVED").length,
        unpaid: view.filter((a) => a.payment_status === "UNPAID" || a.payment_status === "REQUESTED").length,
        contact: tasks.filter((t) => t.contactStatus === "UNREACHED").length,
      },
      appointments: view,
      assigned_followups: tasks.map((t) => ({
        id: t.id,
        patient_name: taskNames.get(t.patientId) ?? "",
        reason: t.reason,
        due_at: t.dueAt.toISOString(),
        contact_status: t.contactStatus,
      })),
    };
  });

  /** Appointments for one clinic day (IST), practice-scoped; defaults to today. */
  app.get<{ Querystring: { practice_id?: string; date?: string } }>("/staff/schedule", async (request, reply) => {
    const member = staffMember(request, reply);
    if ("statusCode" in member) return member;
    const day = request.query.date ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return error(request, reply, 400, "VALIDATION_ERROR", "Invalid date");
    const start = new Date(`${day}T00:00:00+05:30`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const database = requireDb();
    const doctorIds = await practiceDoctorIds(member.practiceId);
    const scope = member.assignedDoctorId
      ? eq(appointments.doctorId, member.assignedDoctorId)
      : or(eq(appointments.practiceId, member.practiceId), doctorIds.length ? inArray(appointments.doctorId, doctorIds) : undefined);
    const rows = await database
      .select()
      .from(appointments)
      .where(and(scope, gte(appointments.scheduledStart, start), lt(appointments.scheduledStart, end)))
      .orderBy(asc(appointments.scheduledStart));
    const intakes = rows.length
      ? await database.select().from(appointmentIntakes).where(inArray(appointmentIntakes.appointmentId, rows.map((r) => r.id)))
      : [];
    const names = await patientNames(rows.map((r) => r.patientId));
    return {
      date: day,
      role: member.role,
      appointments: rows.map((r) => ({
        ...appointmentView(r, names.get(r.patientId) ?? ""),
        intake_status: intakes.find((i) => i.appointmentId === r.id)?.status ?? null,
      })),
    };
  });

  /**
   * Operational patient list: patients with an appointment at this practice's doctors.
   * Name, claim state, masked phone and next visit only; each patient shown is written to the access ledger.
   */
  app.get<{ Querystring: { practice_id?: string; q?: string } }>("/staff/patients", async (request, reply) => {
    const member = staffMember(request, reply);
    if ("statusCode" in member) return member;
    const database = requireDb();
    const doctorIds = await practiceDoctorIds(member.practiceId);
    const scope = member.assignedDoctorId
      ? eq(appointments.doctorId, member.assignedDoctorId)
      : or(eq(appointments.practiceId, member.practiceId), doctorIds.length ? inArray(appointments.doctorId, doctorIds) : undefined);
    const appts = await database
      .select({ patientId: appointments.patientId, start: appointments.scheduledStart, status: appointments.status })
      .from(appointments)
      .where(scope)
      .orderBy(asc(appointments.scheduledStart));
    const ids = [...new Set(appts.map((a) => a.patientId))];
    if (ids.length === 0) return [];
    const rows = await database
      .select({ id: patients.id, status: patients.status, identity: patientIdentity })
      .from(patients)
      .innerJoin(patientIdentity, eq(patientIdentity.patientId, patients.id))
      .where(inArray(patients.id, ids));
    const q = request.query.q?.trim().toLowerCase();
    const now = Date.now();
    const result = rows
      .map((r) => {
        const identity = decryptMinimal(r.identity);
        const next = appts.find((a) => a.patientId === r.id && a.start.getTime() >= now && ["REQUESTED", "CONFIRMED"].includes(a.status));
        return {
          patient_id: r.id,
          full_name: identity.full_name,
          claim_status: r.status,
          phone_hint: `\u2022\u2022\u2022 ${identity.phone.slice(-4)}`,
          next_appointment_at: next?.start.toISOString() ?? null,
        };
      })
      .filter((p) => !q || p.full_name.toLowerCase().includes(q))
      .slice(0, 50);
    for (const p of result) {
      await logAccess(request, { patientId: p.patient_id, purpose: "Clinic operations patient list", resourceType: "patient_demographics", action: "READ" });
    }
    return result;
  });

  /** Intake state for one appointment; vitals are visible to assistants only. */
  app.get<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/intake", async (request, reply) => {
    const member = staffMember(request, reply);
    if ("statusCode" in member) return member;
    const appointment = await scopedAppointment(member, request.params.id);
    if (!appointment) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const database = requireDb();
    const [intake] = await database.select().from(appointmentIntakes).where(eq(appointmentIntakes.appointmentId, appointment.id)).limit(1);
    const names = await patientNames([appointment.patientId]);
    const base = {
      appointment_id: appointment.id,
      patient_name: names.get(appointment.patientId) ?? "",
      scheduled_start: appointment.scheduledStart.toISOString(),
      reason: appointment.reason,
      intake_status: intake?.status ?? null,
      clinical_intake_locked: member.role !== "ASSISTANT",
    };
    if (member.role !== "ASSISTANT") return { ...base, vitals: [] };
    const vitals = await database.select().from(intakeVitals).where(eq(intakeVitals.appointmentId, appointment.id));
    await logAccess(request, {
      patientId: appointment.patientId,
      purpose: "Clinic intake",
      resourceType: "intake_vitals",
      resourceId: appointment.id,
      action: "READ",
    });
    return { ...base, intake_note: intake?.intakeNote ?? null, vitals: vitals.map(vitalsView) };
  });

  /** Records arrival or waiting. Receptionists and assistants may do this. */
  for (const [path, status] of [
    ["arrive", "ARRIVED"],
    ["waiting", "WAITING"],
  ] as const) {
    app.post<{ Params: { id: string }; Querystring: { practice_id?: string } }>(`/staff/appointments/:id/${path}`, async (request, reply) => {
      const member = staffMember(request, reply);
      if ("statusCode" in member) return member;
      const appointment = await scopedAppointment(member, request.params.id);
      if (!appointment) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
      if (!["REQUESTED", "CONFIRMED"].includes(appointment.status)) {
        return error(request, reply, 409, "INVALID_STATE", "Appointment is not active");
      }
      const now = new Date();
      const [row] = await requireDb()
        .insert(appointmentIntakes)
        .values({ appointmentId: appointment.id, practiceId: member.practiceId, status, arrivedAt: now, updatedByProfileId: request.auth.profileId })
        .onConflictDoUpdate({
          target: appointmentIntakes.appointmentId,
          set: { status, updatedAt: now, updatedByProfileId: request.auth.profileId },
          setWhere: eq(appointmentIntakes.status, status === "WAITING" ? "ARRIVED" : "WAITING"),
        })
        .returning();
      return { appointment_id: appointment.id, intake_status: row?.status ?? status };
    });
  }

  /** Assistant enters vitals with CLINIC_STAFF provenance; out-of-range values need doctor review. */
  app.put<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/vitals", async (request, reply) => {
    const member = staffMember(request, reply, ["ASSISTANT"]);
    if ("statusCode" in member) return member;
    const parsed = intakeVitalsSchema.safeParse(request.body);
    if (!parsed.success) return error(request, reply, 400, "VALIDATION_ERROR", parsed.error.issues[0]?.message ?? "Invalid vitals");
    const appointment = await scopedAppointment(member, request.params.id);
    if (!appointment) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const v = parsed.data;
    const database = requireDb();
    const row = await database.transaction(async (tx) => {
      const [vital] = await tx
        .insert(intakeVitals)
        .values({
          appointmentId: appointment.id,
          encounterId: appointment.encounterId,
          patientId: appointment.patientId,
          temperatureC: v.temperature_c?.toString(),
          pulseBpm: v.pulse_bpm,
          systolicMmhg: v.systolic_mmhg,
          diastolicMmhg: v.diastolic_mmhg,
          spo2Percent: v.spo2_percent,
          weightKg: v.weight_kg?.toString(),
          needsDoctorReview: vitalsNeedReview(v),
          provenance: "CLINIC_STAFF",
          enteredByProfileId: request.auth.profileId,
        })
        .returning();
      if (v.intake_note !== undefined) {
        await tx
          .insert(appointmentIntakes)
          .values({ appointmentId: appointment.id, practiceId: member.practiceId, status: "ARRIVED", intakeNote: v.intake_note, updatedByProfileId: request.auth.profileId })
          .onConflictDoUpdate({ target: appointmentIntakes.appointmentId, set: { intakeNote: v.intake_note, updatedAt: new Date() } });
      }
      return vital!;
    });
    await logAccess(request, {
      patientId: appointment.patientId,
      purpose: "Clinic intake vitals",
      resourceType: "intake_vitals",
      resourceId: row.id,
      action: "CREATE",
    });
    return reply.code(201).send(vitalsView(row));
  });

  /** Marks the patient Ready for Doctor. Requires at least one recorded vitals entry. */
  app.post<{ Params: { id: string }; Querystring: { practice_id?: string } }>("/staff/appointments/:id/ready", async (request, reply) => {
    const member = staffMember(request, reply, ["ASSISTANT"]);
    if ("statusCode" in member) return member;
    const appointment = await scopedAppointment(member, request.params.id);
    if (!appointment) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const database = requireDb();
    const vitals = await database.select({ id: intakeVitals.id }).from(intakeVitals).where(eq(intakeVitals.appointmentId, appointment.id)).limit(1);
    if (vitals.length === 0) return error(request, reply, 409, "INTAKE_INCOMPLETE", "Record vitals before marking Ready for Doctor");
    const now = new Date();
    const [row] = await database
      .insert(appointmentIntakes)
      .values({ appointmentId: appointment.id, practiceId: member.practiceId, status: "READY_FOR_DOCTOR", arrivedAt: now, readyAt: now, updatedByProfileId: request.auth.profileId })
      .onConflictDoUpdate({ target: appointmentIntakes.appointmentId, set: { status: "READY_FOR_DOCTOR", readyAt: now, updatedAt: now, updatedByProfileId: request.auth.profileId } })
      .returning();
    return { appointment_id: appointment.id, intake_status: row!.status };
  });

  /** The appointment's own doctor reads intake status and staff-entered vitals (Page 18 / Page 4). */
  app.get<{ Params: { id: string } }>("/doctor/appointments/:id/intake", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;
    const database = requireDb();
    const [appointment] = await database
      .select()
      .from(appointments)
      .where(and(eq(appointments.id, request.params.id), eq(appointments.doctorId, doctorId)))
      .limit(1);
    if (!appointment) return error(request, reply, 404, "NOT_FOUND", "Appointment not found");
    const [intake] = await database.select().from(appointmentIntakes).where(eq(appointmentIntakes.appointmentId, appointment.id)).limit(1);
    const vitals = await database.select().from(intakeVitals).where(eq(intakeVitals.appointmentId, appointment.id));
    const people = vitals.length
      ? await database.select({ id: profiles.id, name: profiles.displayName }).from(profiles).where(inArray(profiles.id, vitals.map((v) => v.enteredByProfileId)))
      : [];
    await logAccess(request, {
      patientId: appointment.patientId,
      purpose: "Doctor reviews intake",
      resourceType: "intake_vitals",
      resourceId: appointment.id,
      action: "READ",
    });
    return {
      appointment_id: appointment.id,
      intake_status: intake?.status ?? null,
      intake_note: intake?.intakeNote ?? null,
      vitals: vitals.map((v) => ({ ...vitalsView(v), entered_by: people.find((p) => p.id === v.enteredByProfileId)?.name ?? null })),
    };
  });
}

/** Serializes a vitals row with its provenance label. */
function vitalsView(v: typeof intakeVitals.$inferSelect) {
  return {
    id: v.id,
    temperature_c: v.temperatureC === null ? null : Number(v.temperatureC),
    pulse_bpm: v.pulseBpm,
    systolic_mmhg: v.systolicMmhg,
    diastolic_mmhg: v.diastolicMmhg,
    spo2_percent: v.spo2Percent,
    weight_kg: v.weightKg === null ? null : Number(v.weightKg),
    needs_doctor_review: v.needsDoctorReview,
    provenance: v.provenance,
    recorded_at: v.createdAt.toISOString(),
  };
}
