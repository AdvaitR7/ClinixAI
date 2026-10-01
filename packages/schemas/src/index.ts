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
