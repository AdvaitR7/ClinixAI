import { z } from "zod";

// Shared health-status vocabulary — the Phase 0 proof that web + api can both
// import one schema package (the monorepo's "shared contract").
export const healthStatusSchema = z.enum([
  "stable",
  "needs_attention",
  "critical",
]);

export type HealthStatus = z.infer<typeof healthStatusSchema>;

// --- Phase 1: auth & onboarding (DATABASE_SCHEMA_SPEC §3–§6, API_CONTRACT_SPEC §1–§4) ---

/** Application roles — matches Postgres `user_role` enum (DB spec §3). */
export const userRoleSchema = z.enum([
  "PATIENT",
  "DOCTOR",
  "CLINIC_STAFF",
  "ADMIN",
]);

export type UserRole = z.infer<typeof userRoleSchema>;

/**
 * POST /patients/self (API spec §3). full_name optional here so Clerk's
 * signup name can prefill it; server requires it non-empty.
 */
export const patientOnboardingSchema = z.object({
  full_name: z.string().min(1).max(200),
  phone: z.string().min(1).max(32),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  sex_at_registration: z.string().min(1).max(64),
});

export type PatientOnboarding = z.infer<typeof patientOnboardingSchema>;

/** PATCH /patients/self — all fields optional. */
export const patientUpdateSchema = patientOnboardingSchema.partial();

/** POST /doctors/self (API spec §4). */
export const doctorOnboardingSchema = z.object({
  registration_number: z.string().min(1).max(64),
  registration_authority: z.string().min(1).max(200),
  qualification: z.string().max(200).optional(),
  speciality: z.string().max(200).optional(),
});

export type DoctorOnboarding = z.infer<typeof doctorOnboardingSchema>;

/** GET /me (API spec §2). role=null edge is never emitted — see meResponseSchema below. */
const meBaseSchema = z.object({
  profile_id: z.string().uuid(),
  role: userRoleSchema,
  patient_id: z.string().uuid().nullable(),
  doctor_id: z.string().uuid().nullable(),
  verification_status: z.string().nullable(),
});

/** GET /me response — profile exists, so role is always set. */
export const meResponseSchema = meBaseSchema;

export type MeResponse = z.infer<typeof meResponseSchema>;

/** Error envelope (API spec §1). */
export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    request_id: z.string(),
  }),
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

// --- Phase 2: core dossiers (DB §3, §8, §11, §22; API §5, §7, §8, §14, §15, §31–32) ---

export const relationshipTypeSchema = z.enum([
  "PRIMARY_PHYSICIAN",
  "DERMATOLOGIST",
  "CARDIOLOGIST",
  "DENTIST",
  "PSYCHIATRIST",
  "OTHER",
]);
export type RelationshipType = z.infer<typeof relationshipTypeSchema>;

export const encounterTypeSchema = z.enum([
  "AI_SELF_CARE",
  "DOCTOR_ONLINE",
  "DOCTOR_IN_PERSON",
  "FOLLOW_UP",
  "RECORD_IMPORT",
]);
export type EncounterType = z.infer<typeof encounterTypeSchema>;

export const encounterStatusSchema = z.enum([
  "OPEN",
  "WAITING_FOR_PATIENT",
  "WAITING_FOR_DOCTOR",
  "COMPLETED",
  "CANCELLED",
  "ESCALATED",
]);
export type EncounterStatus = z.infer<typeof encounterStatusSchema>;

export const appointmentTypeSchema = z.enum(["ONLINE", "IN_PERSON"]);
export type AppointmentType = z.infer<typeof appointmentTypeSchema>;

export const appointmentStatusSchema = z.enum([
  "REQUESTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const paymentStatusSchema = z.enum([
  "UNPAID",
  "REQUESTED",
  "PAID",
  "WAIVED",
  "REFUNDED",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

/** POST /doctor/patients (API spec §5). Field is `mobile` per spec. */
export const doctorCreatePatientSchema = z.object({
  full_name: z.string().min(1).max(200),
  mobile: z.string().min(1).max(32),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
  sex_at_registration: z.string().min(1).max(64),
  relationship_type: relationshipTypeSchema.optional(),
  preferred: z.boolean().optional(),
});
export type DoctorCreatePatient = z.infer<typeof doctorCreatePatientSchema>;

/** POST /patients/self/doctors/{doctor_id}/relationships (API spec §7). */
export const relationshipUpsertSchema = z.object({
  relationship_type: relationshipTypeSchema,
  preferred: z.boolean().optional(),
});
export type RelationshipUpsert = z.infer<typeof relationshipUpsertSchema>;

/** POST /patients/self/encounters (API spec §8). */
export const createEncounterSchema = z.object({
  encounter_type: encounterTypeSchema,
  chief_concern: z.string().max(2000).optional(),
});
export type CreateEncounter = z.infer<typeof createEncounterSchema>;

/** POST /patients/self/appointments (API spec §15). */
export const bookAppointmentSchema = z.object({
  doctor_id: z.string().uuid(),
  encounter_id: z.string().uuid().optional(),
  appointment_type: appointmentTypeSchema,
  scheduled_start: z.string().min(1),
  reason: z.string().max(1000).optional(),
});
export type BookAppointment = z.infer<typeof bookAppointmentSchema>;

/** POST /doctor/appointments/{id}/payment-status (API spec §15). */
export const paymentStatusUpdateSchema = z.object({
  payment_status: paymentStatusSchema,
  reference_note: z.string().max(1000).optional(),
});
export type PaymentStatusUpdate = z.infer<typeof paymentStatusUpdateSchema>;

/** PUT /doctors/self/availability (contract extension). */
export const doctorAvailabilitySchema = z.object({
  template: z.array(
    z.object({
      day_of_week: z.number().int().min(0).max(6),
      start_time: z.string().min(1),
      end_time: z.string().min(1),
    }),
  ),
  slot_duration_minutes: z.number().int().min(5).max(240).optional(),
});
export type DoctorAvailability = z.infer<typeof doctorAvailabilitySchema>;

export const availabilityQuerySchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: appointmentTypeSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

// --- Phase 2 response views ---

export const availabilitySlotSchema = z.object({
  start: z.string(),
  end: z.string(),
});
export type AvailabilitySlot = z.infer<typeof availabilitySlotSchema>;

export const appointmentViewSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  appointment_type: appointmentTypeSchema,
  status: appointmentStatusSchema,
  scheduled_start: z.string(),
  scheduled_end: z.string().nullable(),
  reason: z.string().nullable(),
  payment_status: paymentStatusSchema,
  patient_name: z.string(),
});
export type AppointmentView = z.infer<typeof appointmentViewSchema>;

export const relationshipViewSchema = z.object({
  doctor_id: z.string().uuid(),
  doctor_name: z.string(),
  speciality: z.string().nullable(),
  relationship_type: relationshipTypeSchema,
  preferred: z.boolean(),
});
export type RelationshipView = z.infer<typeof relationshipViewSchema>;

export const doctorOptionSchema = z.object({
  doctor_id: z.string().uuid(),
  name: z.string(),
  speciality: z.string().nullable(),
});
export type DoctorOption = z.infer<typeof doctorOptionSchema>;

export const doctorDirectoryEntrySchema = z.object({
  patient_id: z.string().uuid(),
  full_name: z.string(),
  phone: z.string(),
  date_of_birth: z.string().nullable(),
  sex_at_registration: z.string().nullable(),
  status: z.string(),
  relationship_status: z.string().nullable(),
  last_encounter_at: z.string().nullable(),
});
export type DoctorDirectoryEntry = z.infer<typeof doctorDirectoryEntrySchema>;

export const encounterViewSchema = z.object({
  id: z.string().uuid(),
  encounter_type: encounterTypeSchema,
  status: encounterStatusSchema,
  chief_concern: z.string().nullable(),
  started_at: z.string(),
});
export type EncounterView = z.infer<typeof encounterViewSchema>;

export const timelineEntrySchema = z.object({
  kind: z.enum(["appointment", "encounter"]),
  at: z.string(),
  label: z.string(),
});
export type TimelineEntry = z.infer<typeof timelineEntrySchema>;

export const doctorWorkspaceSchema = z.object({
  patient_id: z.string().uuid(),
  identity: z.object({
    full_name: z.string(),
    phone_last4: z.string(),
    date_of_birth: z.string().nullable(),
    sex_at_registration: z.string().nullable(),
  }),
  allergies: z.array(z.string()),
  consent_active: z.boolean().nullable(),
  current_concern: z.string().nullable(),
  relationships: z.array(relationshipViewSchema),
  appointments: z.array(appointmentViewSchema),
  timeline: z.array(timelineEntrySchema),
});
export type DoctorWorkspace = z.infer<typeof doctorWorkspaceSchema>;

export const doctorDashboardSchema = z.object({
  today_appointments: z.array(appointmentViewSchema),
  incoming_requests: z.array(appointmentViewSchema),
  draft_queue: z.object({ pending: z.number(), high_risk: z.number() }),
  followups_due: z.object({ due_today: z.number(), overdue: z.number() }),
});
export type DoctorDashboard = z.infer<typeof doctorDashboardSchema>;

export const patientDashboardSchema = z.object({
  upcoming_appointment: appointmentViewSchema.nullable(),
  preferred_doctor: relationshipViewSchema.nullable(),
  recent_timeline: z.array(timelineEntrySchema),
  pending_followups: z.array(z.unknown()),
  recent_report: z.unknown().nullable(),
});
export type PatientDashboard = z.infer<typeof patientDashboardSchema>;
