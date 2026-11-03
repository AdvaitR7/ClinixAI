import "dotenv/config";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db.js";
import { doctors, practiceMembers, profiles, appointments } from "../schema.js";
import { adminClient, apiClient, ensureUser, need, tokenFor } from "./clients.js";
import { seedPersonaA, seedPersonaB, seedPersonaC } from "./history.js";
import { ALL_ACCOUNTS, ASSISTANT, DOCTOR, PATIENT_A, PATIENT_B, PATIENT_C, PRACTICE_NAME, RECEPTIONIST, type AccountSpec, type PatientSpec } from "./personas.js";

const API_BASE = process.env.SEED_API_BASE_URL ?? "http://localhost:4000/api/v1";
const api = apiClient(API_BASE);
const created: string[] = [];
const skipped: string[] = [];

/** Records whether a step changed anything, for the closing summary. */
function note(changed: boolean, what: string) {
  (changed ? created : skipped).push(what);
}

/** Hashes a contact the same way invitations do, to find a pending invitation for a demo account. */
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Onboards the demo doctor, publishes the profile and availability, and verifies the synthetic registration. */
async function seedDoctor(token: string): Promise<string> {
  const onboarded = await api(token, "POST", "/doctors/self", {
    registration_number: DOCTOR.registrationNumber,
    registration_authority: DOCTOR.authority,
    qualification: DOCTOR.qualification,
    speciality: DOCTOR.speciality,
  });
  if (![200, 201].includes(onboarded.status)) throw new Error(`Doctor onboarding failed (${onboarded.status})`);
  note(onboarded.status === 201, "doctor onboarding");
  const doctorId: string = onboarded.json.doctor_id;

  const profile = await api(token, "PUT", "/doctors/self/profile", {
    bio: "General physician with a focus on respiratory and metabolic care.",
    languages: ["English", "Hindi", "Kannada"],
    visit_duration_minutes: 15,
    services: [
      { name: "Clinic consultation", mode: "IN_CLINIC", fee_inr: 600, duration_minutes: 15 },
      { name: "Online consultation", mode: "ONLINE", fee_inr: 500, duration_minutes: 15 },
    ],
    accepting_appointments: true,
    directory_visible: true,
  });
  if (profile.status !== 200) throw new Error(`Doctor profile failed (${profile.status})`);

  // Mon-Sat, morning and evening sessions.
  const template = [1, 2, 3, 4, 5, 6].flatMap((day) => [
    { day_of_week: day, start_time: "10:00", end_time: "13:00" },
    { day_of_week: day, start_time: "17:00", end_time: "20:00" },
  ]);
  const availability = await api(token, "PUT", "/doctors/self/availability", { template, slot_duration_minutes: 15 });
  if (![200, 201].includes(availability.status)) throw new Error(`Doctor availability failed (${availability.status})`);

  // There is no admin verification flow yet; the synthetic demo doctor is marked verified so the directory lists them.
  const verified = await db!.update(doctors).set({ verificationStatus: "VERIFIED", verifiedAt: new Date() }).where(and(eq(doctors.id, doctorId), eq(doctors.verificationStatus, "PENDING"))).returning({ id: doctors.id });
  note(verified.length > 0, "doctor verification (synthetic)");
  return doctorId;
}

/** Finds the demo practice for the doctor or creates it. */
async function seedPractice(token: string): Promise<string> {
  const mine = await api(token, "GET", "/practices/mine");
  const existing = (mine.json ?? []).find((p: { practice_name: string }) => p.practice_name === PRACTICE_NAME);
  if (existing) {
    note(false, "practice");
    return existing.practice_id;
  }
  const made = await api(token, "POST", "/practices", { name: PRACTICE_NAME });
  if (made.status !== 201) throw new Error(`Practice creation failed (${made.status})`);
  note(true, "practice");
  return made.json.practice_id;
}

/** Invites a staff account (or reuses its pending invitation) and accepts it as that account. */
async function seedStaff(doctorToken: string, practiceId: string, spec: AccountSpec, userId: string, role: "RECEPTION" | "ASSISTANT", doctorId: string) {
  const [active] = await db!
    .select({ id: practiceMembers.id })
    .from(practiceMembers)
    .innerJoin(profiles, eq(profiles.id, practiceMembers.profileId))
    .where(and(eq(practiceMembers.practiceId, practiceId), eq(practiceMembers.role, role), eq(practiceMembers.status, "ACTIVE"), eq(profiles.supabaseUserId, userId)))
    .limit(1);
  if (active) {
    note(false, `${role.toLowerCase()} membership`);
    return;
  }
  const [pending] = await db!
    .select({ id: practiceMembers.id })
    .from(practiceMembers)
    .where(and(eq(practiceMembers.practiceId, practiceId), eq(practiceMembers.role, role), eq(practiceMembers.status, "INVITED"), eq(practiceMembers.inviteContactHash, sha256(spec.email))))
    .limit(1);
  const invitation = pending
    ? await api(doctorToken, "POST", `/practices/${practiceId}/members/${pending.id}/resend`)
    : await api(doctorToken, "POST", `/practices/${practiceId}/invitations`, { contact: spec.email, role, ...(role === "ASSISTANT" ? { assigned_doctor_id: doctorId } : {}) });
  if (![200, 201].includes(invitation.status)) throw new Error(`Invitation for ${spec.key} failed (${invitation.status})`);
  const accepted = await api(await tokenFor(spec), "POST", `/practice-invitations/${invitation.json.invite_token}/accept`, { contact: spec.email });
  if (accepted.status !== 200) throw new Error(`Invitation acceptance for ${spec.key} failed (${accepted.status})`);
  note(true, `${role.toLowerCase()} membership`);
}

/** Onboards one patient and links them to the demo doctor as their regular doctor. */
async function seedPatient(spec: PatientSpec, doctorId: string): Promise<{ token: string; patientId: string }> {
  const token = await tokenFor(spec);
  const onboarded = await api(token, "POST", "/patients/self", { full_name: spec.displayName, phone: spec.phone, date_of_birth: spec.dob, sex_at_registration: spec.sex });
  if (![200, 201].includes(onboarded.status)) throw new Error(`Patient onboarding for ${spec.key} failed (${onboarded.status})`);
  note(onboarded.status === 201, `${spec.key} onboarding`);
  const link = await api(token, "POST", `/patients/self/doctors/${doctorId}/relationships`, { relationship_type: "PRIMARY_PHYSICIAN", preferred: true });
  if (![200, 201].includes(link.status)) throw new Error(`Relationship for ${spec.key} failed (${link.status})`);
  return { token, patientId: onboarded.json.patient_id };
}

/** Books tomorrow's 11:00 IST visit for Persona A unless an upcoming one already exists. */
async function seedUpcoming(doctorToken: string, patientId: string) {
  const upcoming = await db!.select({ id: appointments.id, start: appointments.scheduledStart, status: appointments.status }).from(appointments).where(eq(appointments.patientId, patientId));
  if (upcoming.some((a) => a.start.getTime() > Date.now() && ["REQUESTED", "CONFIRMED"].includes(a.status))) {
    note(false, "upcoming appointment");
    return;
  }
  const day = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const booked = await api(doctorToken, "POST", "/doctor/appointments", {
    patient_id: patientId,
    appointment_type: "IN_PERSON",
    scheduled_start: new Date(`${day}T11:00:00+05:30`).toISOString(),
    reason: "Cough follow-up",
  });
  if (booked.status !== 201) throw new Error(`Upcoming appointment failed (${booked.status})`);
  note(true, "upcoming appointment");
}

/** Seeds the synthetic demo personas. Additive and idempotent: existing personas are skipped, nothing is deleted. */
async function main() {
  if (!db) throw new Error("DATABASE_URL is required");
  need("SEED_DEMO_PASSWORD");
  const health = await fetch(API_BASE.replace(/\/api\/v1$/, "/health")).catch(() => null);
  if (!health?.ok) throw new Error(`The API is not reachable at ${API_BASE}. Start it first (npm run dev:api).`);

  const admin = adminClient();
  const users = new Map<string, string>();
  for (const spec of ALL_ACCOUNTS) {
    const { id, created: isNew } = await ensureUser(admin, spec);
    users.set(spec.key, id);
    note(isNew, `${spec.key} account`);
  }

  const doctorToken = await tokenFor(DOCTOR);
  const doctorId = await seedDoctor(doctorToken);
  const practiceId = await seedPractice(doctorToken);
  await seedStaff(doctorToken, practiceId, RECEPTIONIST, users.get(RECEPTIONIST.key)!, "RECEPTION", doctorId);
  await seedStaff(doctorToken, practiceId, ASSISTANT, users.get(ASSISTANT.key)!, "ASSISTANT", doctorId);

  const a = await seedPatient(PATIENT_A, doctorId);
  const b = await seedPatient(PATIENT_B, doctorId);
  const c = await seedPatient(PATIENT_C, doctorId);
  note(await seedPersonaA(admin, a.patientId, doctorId), "persona A history");
  note(await seedPersonaB(admin, b.patientId, doctorId), "persona B history");
  note(await seedPersonaC(c.patientId, doctorId), "persona C history");
  await seedUpcoming(doctorToken, a.patientId);

  console.log("Demo accounts (password comes from SEED_DEMO_PASSWORD):");
  for (const spec of ALL_ACCOUNTS) console.log(`  ${spec.email}  ${spec.role}`);
  console.log(`\nCreated this run: ${created.length ? created.join(", ") : "nothing"}`);
  console.log(`Already present:  ${skipped.length ? skipped.join(", ") : "nothing"}`);
  process.exit(0);
}

main().catch((cause) => {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exit(1);
});
