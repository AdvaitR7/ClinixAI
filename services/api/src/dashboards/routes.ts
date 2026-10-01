import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { requireDoctor, requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import {
  appointments,
  doctors,
  encounters,
  patientDoctorRelationships,
  profiles,
} from "../schema.js";
import { appointmentView, patientNames } from "../appointments/map.js";

const IST_MS = (5 * 60 + 30) * 60 * 1000;

function istDayBounds(now: Date) {
  const shifted = new Date(now.getTime() + IST_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();
  return {
    start: new Date(Date.UTC(y, m, d) - IST_MS),
    end: new Date(Date.UTC(y, m, d + 1) - IST_MS),
  };
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/doctor/dashboard", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const database = requireDb();
    const { start, end } = istDayBounds(new Date());

    const [todayRows, incomingRows] = await Promise.all([
      database
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            gte(appointments.scheduledStart, start),
            lte(appointments.scheduledStart, end),
            inArray(appointments.status, ["REQUESTED", "CONFIRMED", "COMPLETED", "NO_SHOW"]),
          ),
        )
        .orderBy(asc(appointments.scheduledStart)),
      database
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.doctorId, doctorId),
            eq(appointments.status, "REQUESTED"),
          ),
        )
        .orderBy(asc(appointments.scheduledStart)),
    ]);

    const allRows = [...todayRows, ...incomingRows];
    const names = await patientNames(allRows.map((r) => r.patientId));

    return {
      today_appointments: todayRows.map((r) => appointmentView(r, names.get(r.patientId) ?? "")),
      incoming_requests: incomingRows.map((r) => appointmentView(r, names.get(r.patientId) ?? "")),
      draft_queue: { pending: 0, high_risk: 0 },
      followups_due: { due_today: 0, overdue: 0 },
    };
  });

  app.get("/patients/self/dashboard", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const database = requireDb();
    const now = new Date();

    const [upcoming, preferred, apptRows, encRows] = await Promise.all([
      database
        .select()
        .from(appointments)
        .where(
          and(
            eq(appointments.patientId, patientId),
            inArray(appointments.status, ["REQUESTED", "CONFIRMED"]),
            gte(appointments.scheduledStart, now),
          ),
        )
        .orderBy(asc(appointments.scheduledStart))
        .limit(1),
      database
        .select({
          doctorId: doctors.id,
          name: profiles.displayName,
          speciality: doctors.speciality,
          relationshipType: patientDoctorRelationships.relationshipType,
          isPreferred: patientDoctorRelationships.isPreferred,
        })
        .from(patientDoctorRelationships)
        .innerJoin(doctors, eq(doctors.id, patientDoctorRelationships.doctorId))
        .innerJoin(profiles, eq(profiles.id, doctors.profileId))
        .where(
          and(
            eq(patientDoctorRelationships.patientId, patientId),
            eq(patientDoctorRelationships.status, "ACTIVE"),
            eq(patientDoctorRelationships.isPreferred, true),
          ),
        )
        .limit(1),
      database
        .select()
        .from(appointments)
        .where(eq(appointments.patientId, patientId))
        .orderBy(desc(appointments.scheduledStart))
        .limit(10),
      database
        .select()
        .from(encounters)
        .where(eq(encounters.patientId, patientId))
        .orderBy(desc(encounters.startedAt))
        .limit(10),
    ]);

    const names = await patientNames(apptRows.map((r) => r.patientId));

    const timeline = [
      ...apptRows.map((a) => ({
        kind: "appointment" as const,
        at: a.scheduledStart.toISOString(),
        label: `Appointment · ${a.status}`,
      })),
      ...encRows.map((e) => ({
        kind: "encounter" as const,
        at: e.startedAt.toISOString(),
        label: `Encounter · ${e.encounterType}`,
      })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);

    return {
      upcoming_appointment: upcoming[0]
        ? appointmentView(upcoming[0], names.get(upcoming[0].patientId) ?? "")
        : null,
      preferred_doctor: preferred[0]
        ? {
            doctor_id: preferred[0].doctorId,
            doctor_name: preferred[0].name,
            speciality: preferred[0].speciality,
            relationship_type: preferred[0].relationshipType,
            preferred: preferred[0].isPreferred,
          }
        : null,
      recent_timeline: timeline,
      pending_followups: [],
      recent_report: null,
    };
  });
}
