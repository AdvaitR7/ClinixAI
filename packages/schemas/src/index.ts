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
 * POST /patients/self (API spec §3). Patient onboarding requires a full name.
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

/** GET /patients/self/appointments — patient's own appointments (doctor-centric). */
export const patientAppointmentViewSchema = z.object({
  id: z.string().uuid(),
  status: appointmentStatusSchema,
  appointment_type: appointmentTypeSchema,
  scheduled_start: z.string(),
  scheduled_end: z.string().nullable(),
  reason: z.string().nullable(),
  payment_status: paymentStatusSchema,
  doctor_id: z.string().uuid(),
  doctor_name: z.string(),
  speciality: z.string().nullable(),
});
export type PatientAppointmentView = z.infer<typeof patientAppointmentViewSchema>;

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
  status: z.string(),
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

// --- Phase 3: clinical loop (DB §18–21; API §15, §19, §22–27) ---

export const prescriptionDraftSourceSchema = z.enum([
  "DIRECT_ENTRY",
  "OCR",
  "VOICE",
]);
export type PrescriptionDraftSource = z.infer<typeof prescriptionDraftSourceSchema>;

export const prescriptionDraftStatusSchema = z.enum([
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);
export type PrescriptionDraftStatus = z.infer<typeof prescriptionDraftStatusSchema>;

export const prescriptionStatusSchema = z.enum([
  "ACTIVE",
  "SUPERSEDED",
  "CANCELLED",
]);
export type PrescriptionStatus = z.infer<typeof prescriptionStatusSchema>;

/** One structured medicine line (DB §18.2). All text, medicine_name required. */
export const prescriptionItemInputSchema = z.object({
  medicine_name: z.string().min(1).max(500),
  strength: z.string().max(500).optional(),
  dose: z.string().max(500).optional(),
  route: z.string().max(500).optional(),
  frequency: z.string().max(500).optional(),
  timing: z.string().max(500).optional(),
  duration: z.string().max(500).optional(),
  instructions: z.string().max(1000).optional(),
});
export type PrescriptionItemInput = z.infer<typeof prescriptionItemInputSchema>;

/** POST /doctor/encounters/{id}/prescription-drafts (API §19). */
export const createPrescriptionDraftSchema = z.object({
  source: z.literal("DIRECT_ENTRY"),
  items: z.array(prescriptionItemInputSchema).min(1),
});
export type CreatePrescriptionDraft = z.infer<typeof createPrescriptionDraftSchema>;

/** PATCH /doctor/prescription-drafts/{id} — replace items, or set a terminal status. */
export const patchPrescriptionDraftSchema = z.object({
  items: z.array(prescriptionItemInputSchema).min(1).optional(),
  status: z.enum(["DRAFT", "REJECTED", "EXPIRED"]).optional(),
});
export type PatchPrescriptionDraft = z.infer<typeof patchPrescriptionDraftSchema>;

/** POST /doctor/prescriptions/{id}/amend (API §24). */
export const amendPrescriptionSchema = z.object({
  reason: z.string().min(1).max(1000),
  items: z.array(prescriptionItemInputSchema).min(1),
});
export type AmendPrescription = z.infer<typeof amendPrescriptionSchema>;

/** Consultation note sections (DB §21). */
export const noteSectionsSchema = z.object({
  complaint: z.string().max(5000).optional(),
  observations: z.string().max(5000).optional(),
  assessment: z.string().max(5000).optional(),
  plan: z.string().max(5000).optional(),
});
export type NoteSections = z.infer<typeof noteSectionsSchema>;

export const noteAmendSchema = noteSectionsSchema.extend({
  reason: z.string().min(1).max(1000),
});
export type NoteAmend = z.infer<typeof noteAmendSchema>;

/** POST /doctor/encounters (contract extension — doctor-initiated encounter). */
export const doctorCreateEncounterSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().optional(),
  encounter_type: encounterTypeSchema.optional(),
  chief_concern: z.string().max(2000).optional(),
});
export type DoctorCreateEncounter = z.infer<typeof doctorCreateEncounterSchema>;

/** POST /doctor/appointments (contract extension — walk-in booking). */
export const doctorBookAppointmentSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_type: appointmentTypeSchema,
  scheduled_start: z.string().min(1),
  reason: z.string().max(1000).optional(),
});
export type DoctorBookAppointment = z.infer<typeof doctorBookAppointmentSchema>;

/** POST /patient-claims (API §6). */
export const patientClaimSchema = z.object({
  invite_token: z.string().min(8).max(256),
});
export type PatientClaim = z.infer<typeof patientClaimSchema>;

// --- Phase 3 response views ---

export const prescriptionDraftItemViewSchema = prescriptionItemInputSchema.extend({
  id: z.string().uuid(),
  sequence_number: z.number(),
  needs_review: z.boolean(),
  field_confidence: z.unknown().nullable(),
});
export type PrescriptionDraftItemView = z.infer<typeof prescriptionDraftItemViewSchema>;

export const prescriptionDraftViewSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  encounter_id: z.string().uuid().nullable(),
  doctor_id: z.string().uuid(),
  source: prescriptionDraftSourceSchema,
  status: prescriptionDraftStatusSchema,
  patient_name: z.string(),
  created_at: z.string(),
  overall_confidence: z.number().nullable(),
  risk_flags: z.unknown().nullable(),
  source_document_id: z.string().uuid().nullable(),
  items: z.array(prescriptionDraftItemViewSchema),
});
export type PrescriptionDraftView = z.infer<typeof prescriptionDraftViewSchema>;

export const prescriptionItemViewSchema = z.object({
  medicine_name: z.string(),
  medicine_code: z.string().nullable(),
  strength: z.string().nullable(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  frequency: z.string().nullable(),
  timing: z.string().nullable(),
  duration: z.string().nullable(),
  instructions: z.string().nullable(),
});
export type PrescriptionItemView = z.infer<typeof prescriptionItemViewSchema>;

export const prescriptionVersionViewSchema = z.object({
  version_number: z.number(),
  finalized_by: z.string(),
  finalized_at: z.string(),
  amendment_reason: z.string().nullable(),
  items: z.array(prescriptionItemViewSchema),
});
export type PrescriptionVersionView = z.infer<typeof prescriptionVersionViewSchema>;

export const prescriptionViewSchema = z.object({
  id: z.string().uuid(),
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid(),
  status: prescriptionStatusSchema,
  created_at: z.string(),
  current_version: prescriptionVersionViewSchema,
  versions: z.array(prescriptionVersionViewSchema),
});
export type PrescriptionView = z.infer<typeof prescriptionViewSchema>;

export const medicationStatusSchema = z.enum(["CURRENT", "PAST", "UNKNOWN_STATUS"]);

export const medicationViewSchema = z.object({
  medicine_name: z.string(),
  dose: z.string().nullable(),
  route: z.string().nullable(),
  frequency: z.string().nullable(),
  status: medicationStatusSchema,
  prescribing_doctor: z.string().nullable(),
  prescribed_date: z.string().nullable(),
  encounter_id: z.string().uuid().nullable(),
  prescription_id: z.string().uuid().nullable(),
  response: z.string().nullable(),
  adverse_reaction: z.string().nullable(),
  reason_stopped: z.string().nullable(),
});
export type MedicationView = z.infer<typeof medicationViewSchema>;

export const consultationContextSchema = z.object({
  appointment: appointmentViewSchema,
  encounter_id: z.string().uuid(),
  note: noteSectionsSchema.nullable(),
  note_is_final: z.boolean(),
  allergies: z.array(z.string()),
  current_medications: z.array(medicationViewSchema),
});
export type ConsultationContext = z.infer<typeof consultationContextSchema>;

export const claimInviteViewSchema = z.object({
  invite_token: z.string(),
  expires_at: z.string(),
});
export type ClaimInviteView = z.infer<typeof claimInviteViewSchema>;

// --- Phase 4: documents & OCR (DB §16–17; API §11–12) ---

export const documentTypeSchema = z.enum([
  "LAB_REPORT",
  "PRESCRIPTION",
  "IMAGING_REPORT",
  "DISCHARGE_SUMMARY",
  "CONSULTATION_NOTE",
  "OTHER",
]);
export type DocumentType = z.infer<typeof documentTypeSchema>;

export const documentProcessingStatusSchema = z.enum([
  "UPLOADED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "COMPLETE",
  "FAILED",
]);
export type DocumentProcessingStatus = z.infer<typeof documentProcessingStatusSchema>;

/** POST .../documents/upload-init (API §11). */
export const uploadInitSchema = z.object({
  filename: z.string().min(1).max(512),
  mime_type: z.enum(["image/png", "image/jpeg", "application/pdf"]),
  document_type: documentTypeSchema,
  encounter_id: z.string().uuid().optional(),
});
export type UploadInit = z.infer<typeof uploadInitSchema>;

/** upload-init response — storage-js passthrough (underspecified in API §11). */
export const uploadInitResponseSchema = z.object({
  document_id: z.string().uuid(),
  upload_url: z.string(),
  token: z.string(),
  path: z.string(),
  expires_in: z.number(),
});
export type UploadInitResponse = z.infer<typeof uploadInitResponseSchema>;

export const documentViewSchema = z.object({
  document_id: z.string().uuid(),
  document_type: documentTypeSchema,
  original_filename: z.string(),
  mime_type: z.string(),
  file_size_bytes: z.number().nullable(),
  processing_status: documentProcessingStatusSchema,
  created_at: z.string(),
  view_url: z.string().nullable(),
});
export type DocumentView = z.infer<typeof documentViewSchema>;

export const labObservationViewSchema = z.object({
  id: z.string().uuid(),
  test_name: z.string(),
  test_code: z.string().nullable(),
  value_numeric: z.number().nullable(),
  value_text: z.string().nullable(),
  unit: z.string().nullable(),
  reference_low: z.number().nullable(),
  reference_high: z.number().nullable(),
  reference_text: z.string().nullable(),
  flag: z.string().nullable(),
  observed_at: z.string().nullable(),
  confidence: z.number().nullable(),
  needs_review: z.boolean(),
  confirmed_at: z.string().nullable(),
});
export type LabObservationView = z.infer<typeof labObservationViewSchema>;

export const labReportViewSchema = z.object({
  report_id: z.string().uuid(),
  laboratory_name: z.string().nullable(),
  collection_date: z.string().nullable(),
  report_date: z.string().nullable(),
  source_document_id: z.string().uuid(),
  created_at: z.string(),
  observations: z.array(labObservationViewSchema),
});
export type LabReportView = z.infer<typeof labReportViewSchema>;

export const labTrendPointSchema = z.object({
  observed_at: z.string(),
  value_numeric: z.number(),
  report_id: z.string().uuid(),
  confidence: z.number().nullable(),
});
export type LabTrendPoint = z.infer<typeof labTrendPointSchema>;

export const labTrendSchema = z.object({
  test_name: z.string(),
  points: z.array(labTrendPointSchema),
});
export type LabTrend = z.infer<typeof labTrendSchema>;

/** PATCH /patients/self/lab-observations/:id — confirm and/or correct. */
export const patchObservationSchema = z.object({
  value_numeric: z.number().nullable().optional(),
  value_text: z.string().nullable().optional(),
  unit: z.string().nullable().optional(),
  confirmed: z.boolean().optional(),
});
export type PatchObservation = z.infer<typeof patchObservationSchema>;

// --- OCR output contracts (worker strict-parse; extras default so omissions never fail) ---

/** Qualitative confidence thresholds — single source for worker gating + web labels. */
export const OCR_CONFIDENCE_THRESHOLDS = { HIGH: 0.85, MEDIUM: 0.6 } as const;

export function confidenceLabel(
  n: number | null | undefined,
): "HIGH" | "MEDIUM" | "LOW" {
  if (n == null) return "LOW";
  if (n >= OCR_CONFIDENCE_THRESHOLDS.HIGH) return "HIGH";
  if (n >= OCR_CONFIDENCE_THRESHOLDS.MEDIUM) return "MEDIUM";
  return "LOW";
}

/** True when a value is LOW/missing confidence and needs human review. */
export function needsReviewByConfidence(n: number | null | undefined): boolean {
  return confidenceLabel(n) === "LOW";
}

// ponytail: master plan targets ai/schemas/ocr.ts; lives in @clinix/schemas until
// a second consumer outside the workspaces needs it (Phase 5 prompts/ai/ dir).
export const ocrPrescriptionSchema = z.object({
  raw_text: z.string().default(""),
  medicines: z
    .array(
      z.object({
        medicine_name: z.string(),
        strength: z.string().nullable().default(null),
        dose: z.string().nullable().default(null),
        route: z.string().nullable().default(null),
        frequency: z.string().nullable().default(null),
        timing: z.string().nullable().default(null),
        duration: z.string().nullable().default(null),
        instructions: z.string().nullable().default(null),
        confidence: z.number().min(0).max(1).default(0),
      }),
    )
    .min(1),
  overall_confidence: z.number().min(0).max(1).default(0),
  risk_flags: z.array(z.string()).default([]),
});
export type OcrPrescription = z.infer<typeof ocrPrescriptionSchema>;

export const ocrLabReportSchema = z.object({
  raw_text: z.string().default(""),
  laboratory_name: z.string().nullable().default(null),
  collection_date: z.string().nullable().default(null),
  report_date: z.string().nullable().default(null),
  observations: z
    .array(
      z.object({
        test_name: z.string(),
        value_numeric: z.number().nullable().default(null),
        value_text: z.string().nullable().default(null),
        unit: z.string().nullable().default(null),
        reference_text: z.string().nullable().default(null),
        confidence: z.number().min(0).max(1).default(0),
      }),
    )
    .min(1),
});
export type OcrLabReport = z.infer<typeof ocrLabReportSchema>;

// --- Phase 5: AI check-in, consensus & timeline (DB §12, §28–31; API §9–10, §13, §18) ---

export const aiRoleSchema = z.enum([
  "ANALYST_1",
  "ANALYST_2",
  "JUDGE",
  "OUTPUT_COMPOSER",
]);
export type AiRole = z.infer<typeof aiRoleSchema>;

export const aiRunStatusSchema = z.enum([
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
]);
export type AiRunStatus = z.infer<typeof aiRunStatusSchema>;

export const interactionBlockTypeSchema = z.enum([
  "single_select",
  "multi_select",
  "numeric",
  "date",
  "scale",
  "free_text",
]);
export type InteractionBlockType = z.infer<typeof interactionBlockTypeSchema>;

export const interactionSessionStatusSchema = z.enum([
  "IN_PROGRESS",
  "COMPLETED",
  "ESCALATED",
]);
export type InteractionSessionStatus = z.infer<typeof interactionSessionStatusSchema>;

export const historicalSimilarityLabelSchema = z.enum([
  "STRONGLY_SIMILAR",
  "PARTIALLY_SIMILAR",
  "INSUFFICIENTLY_SIMILAR",
]);
export type HistoricalSimilarityLabel = z.infer<typeof historicalSimilarityLabelSchema>;

export const safetySeveritySchema = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export type SafetySeverity = z.infer<typeof safetySeveritySchema>;

export const safetyActionSchema = z.enum(["ALLOW", "ASK_MORE", "BLOCK_NORMAL_FLOW"]);
export type SafetyAction = z.infer<typeof safetyActionSchema>;

export const provenanceAuthoritySchema = z.enum([
  "PATIENT_ASSERTED",
  "DOCTOR_AUTHORED",
  "SOURCE_DOCUMENT_DERIVED",
  "AI_DERIVED",
]);
export type ProvenanceAuthority = z.infer<typeof provenanceAuthoritySchema>;

export const interactionOptionSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string().optional(),
});
export type InteractionOption = z.infer<typeof interactionOptionSchema>;

export const interactionBlockViewSchema = z.object({
  id: z.string().uuid(),
  sequence_number: z.number(),
  block_type: z.string(),
  title: z.string(),
  help_text: z.string().nullable().default(null),
  options: z.array(interactionOptionSchema).nullable().default(null),
  allow_free_text: z.boolean().default(true),
});
export type InteractionBlockView = z.infer<typeof interactionBlockViewSchema>;

export const interactionStartSchema = z.object({
  chief_concern: z.string().min(1),
});
export type InteractionStart = z.infer<typeof interactionStartSchema>;

export const interactionResponseInputSchema = z.object({
  block_id: z.string().uuid(),
  selected_option_ids: z.array(z.string()).optional(),
  free_text: z.string().nullable().optional(),
  numeric_value: z.number().nullable().optional(),
  date_value: z.string().nullable().optional(),
});
export type InteractionResponseInput = z.infer<typeof interactionResponseInputSchema>;

export const safetyAlertSchema = z.object({
  severity: safetySeveritySchema,
  action: safetyActionSchema,
  triggered_rule_ids: z.array(z.string()),
  message: z.string(),
  emergency_number: z.string().default("112 / 108"),
});
export type SafetyAlert = z.infer<typeof safetyAlertSchema>;

export const interactionResponseResultSchema = z.object({
  status: z.enum(["NEEDS_MORE_INFORMATION", "READY_FOR_ANALYSIS", "SAFETY_ESCALATION"]),
  next_block: interactionBlockViewSchema.optional(),
  safety_alert: safetyAlertSchema.optional(),
});
export type InteractionResponseResult = z.infer<typeof interactionResponseResultSchema>;

export const analystOutputSchema = z.object({
  important_findings: z.array(z.string()).default([]),
  historical_matches: z
    .array(
      z.object({
        encounter_id: z.string(),
        similarity_label: historicalSimilarityLabelSchema,
        supporting_features: z.array(z.string()).default([]),
        differences: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  missing_information: z.array(z.string()).default([]),
  safety_concerns: z.array(z.string()).default([]),
  supported_guidance: z.array(z.string()).default([]),
  doctor_questions: z.array(z.string()).default([]),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
});
export type AnalystOutput = z.infer<typeof analystOutputSchema>;

export const judgeOutputSchema = z.object({
  agreements: z.array(z.string()).default([]),
  material_disagreements: z.array(z.string()).default([]),
  unsupported_claims: z.array(z.string()).default([]),
  questions_to_ask_next: z.array(z.string()).default([]),
  safe_consensus: z.array(z.string()).default([]),
  requires_doctor_review: z.boolean().default(false),
  requires_urgent_escalation: z.boolean().default(false),
});
export type JudgeOutput = z.infer<typeof judgeOutputSchema>;

export const historicalEpisodeMatchSchema = z.object({
  historical_encounter_id: z.string().uuid(),
  date: z.string().nullable().default(null),
  chief_concern: z.string().nullable().default(null),
  similarity_label: historicalSimilarityLabelSchema,
  similarity_score: z.number().nullable().optional(),
  supporting_features: z.array(z.string()).default([]),
  differences: z.array(z.string()).default([]),
  outcome: z.string().nullable().optional(),
});
export type HistoricalEpisodeMatch = z.infer<typeof historicalEpisodeMatchSchema>;

export const STATUTORY_NON_REUSE_WARNING =
  "Prior treatment is not authorization for reuse. Medicines prescribed for earlier episodes should never be restarted without consulting a doctor.";

export const patientCheckinOutcomeSchema = z.object({
  summary: z.string(),
  low_risk_guidance: z.array(z.string()).default([]),
  uncertainty_level: z.enum(["LOW", "MEDIUM", "HIGH"]).default("LOW"),
  questions_for_doctor: z.array(z.string()).default([]),
  historical_matches: z.array(historicalEpisodeMatchSchema).default([]),
  statutory_warning: z.string().default(STATUTORY_NON_REUSE_WARNING),
});
export type PatientCheckinOutcome = z.infer<typeof patientCheckinOutcomeSchema>;

export const aiSessionViewSchema = z.object({
  ai_session_id: z.string().uuid(),
  encounter_id: z.string().uuid(),
  status: aiRunStatusSchema,
  outcome: patientCheckinOutcomeSchema.nullable().default(null),
  error: z.string().nullable().optional(),
});
export type AiSessionView = z.infer<typeof aiSessionViewSchema>;

export const aiEvidenceSourceRefSchema = z.object({
  resource_type: z.string(),
  resource_id: z.string(),
  description: z.string(),
  date: z.string().nullable().default(null),
});
export type AiEvidenceSourceRef = z.infer<typeof aiEvidenceSourceRefSchema>;

export const aiEvidenceResponseSchema = z.object({
  ai_session_id: z.string().uuid(),
  sources: z.array(aiEvidenceSourceRefSchema).default([]),
});
export type AiEvidenceResponse = z.infer<typeof aiEvidenceResponseSchema>;

export const doctorAiAssistanceViewSchema = z.object({
  encounter_id: z.string().uuid(),
  historical_matches: z.array(historicalEpisodeMatchSchema).default([]),
  agreements: z.array(z.string()).default([]),
  material_disagreements: z.array(z.string()).default([]),
  missing_information: z.array(z.string()).default([]),
  questions_to_ask_patient: z.array(z.string()).default([]),
  uncertainty_score: z.number().nullable().optional(),
  consent_locked_sections: z
    .array(
      z.object({
        section_name: z.string(),
        reason: z.string(),
      }),
    )
    .default([]),
});
export type DoctorAiAssistanceView = z.infer<typeof doctorAiAssistanceViewSchema>;

export const timelineFilterSchema = z.enum([
  "ALL",
  "DOCTOR_VISITS",
  "AI_CHECKINS",
  "LAB_REPORTS",
  "PRESCRIPTIONS",
]);
export type TimelineFilter = z.infer<typeof timelineFilterSchema>;

export const detailedTimelineItemSchema = z.object({
  id: z.string(),
  type: z.enum([
    "ENCOUNTER",
    "AI_CHECKIN",
    "PRESCRIPTION",
    "LAB_REPORT",
    "HEALTH_NOTE",
  ]),
  title: z.string(),
  summary: z.string(),
  timestamp: z.string(),
  date_formatted: z.string(),
  chapter: z.string(),
  provenance: provenanceAuthoritySchema,
  is_ai_derived: z.boolean(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
export type DetailedTimelineItem = z.infer<typeof detailedTimelineItemSchema>;

export const patientTimelineResponseSchema = z.object({
  entries: z.array(detailedTimelineItemSchema).default([]),
  next_cursor: z.string().nullable().default(null),
});
export type PatientTimelineResponse = z.infer<typeof patientTimelineResponseSchema>;

