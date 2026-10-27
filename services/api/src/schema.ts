import type { AvailabilityRules } from "@clinix/schemas";
import {
  bigint,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Postgres bytea has no first-class Drizzle builder; customType maps Buffer
// both directions. postgres-js returns Buffer for bytea; inserts take Buffer.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer): Buffer {
    return value;
  },
  fromDriver(value: Buffer): Buffer {
    return Buffer.isBuffer(value) ? value : Buffer.from(value as string);
  },
});

// --- Enums (DATABASE_SCHEMA_SPEC §3) ---

export const userRole = pgEnum("user_role", [
  "PATIENT",
  "DOCTOR",
  "CLINIC_STAFF",
  "ADMIN",
]);

export const patientStatus = pgEnum("patient_status", [
  "UNCLAIMED",
  "ACTIVE",
  "DEACTIVATED",
  "DELETED",
]);

export const doctorVerificationStatus = pgEnum("doctor_verification_status", [
  "UNVERIFIED",
  "PENDING",
  "VERIFIED",
  "REJECTED",
  "SUSPENDED",
]);

export const actorType = pgEnum("actor_type", [
  "PATIENT",
  "DOCTOR",
  "CLINIC_STAFF",
  "ADMIN",
  "AI_SERVICE",
  "SYSTEM",
]);

// --- Tables (DATABASE_SCHEMA_SPEC §4–§6) ---

/** §4.1 — application-level account metadata. Roles resolve from here. */
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  legacyAuthSubject: text("legacy_auth_subject").unique(),
  supabaseUserId: uuid("supabase_user_id").unique(),
  primaryRole: userRole("primary_role").notNull(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** §5.1 — stable internal patient entity. `accountProfileId = NULL` = unclaimed. */
export const patients = pgTable("patients", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountProfileId: uuid("account_profile_id").references(() => profiles.id),
  status: patientStatus("status").notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  createdByActorType: actorType("created_by_actor_type").notNull(),
  createdByActorId: uuid("created_by_actor_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §5.2 — directly identifying information. Plaintext never stored here;
 * encrypted blobs + deterministic keyed hashes for duplicate detection only.
 */
export const patientIdentity = pgTable("patient_identity", {
  patientId: uuid("patient_id")
    .primaryKey()
    .references(() => patients.id),
  fullNameEncrypted: bytea("full_name_encrypted").notNull(),
  phoneEncrypted: bytea("phone_encrypted").notNull(),
  phoneHash: text("phone_hash"),
  emailEncrypted: bytea("email_encrypted"),
  emailHash: text("email_hash"),
  dateOfBirthEncrypted: bytea("date_of_birth_encrypted"),
  sexAtRegistration: text("sex_at_registration"),
  addressEncrypted: bytea("address_encrypted"),
  emergencyContactEncrypted: bytea("emergency_contact_encrypted"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** §6.1 — one doctor row per profile. New rows start PENDING. */
export const doctors = pgTable("doctors", {
  id: uuid("id").primaryKey().defaultRandom(),
  profileId: uuid("profile_id")
    .notNull()
    .unique()
    .references(() => profiles.id),
  registrationNumber: text("registration_number").notNull(),
  registrationAuthority: text("registration_authority").notNull(),
  qualification: text("qualification"),
  speciality: text("speciality"),
  verificationStatus: doctorVerificationStatus("verification_status")
    .notNull()
    .default("PENDING"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// --- Phase 2 enums (DATABASE_SCHEMA_SPEC §3) ---

export const encounterType = pgEnum("encounter_type", [
  "AI_SELF_CARE",
  "DOCTOR_ONLINE",
  "DOCTOR_IN_PERSON",
  "FOLLOW_UP",
  "RECORD_IMPORT",
]);

export const encounterStatus = pgEnum("encounter_status", [
  "OPEN",
  "WAITING_FOR_PATIENT",
  "WAITING_FOR_DOCTOR",
  "COMPLETED",
  "CANCELLED",
  "ESCALATED",
]);

export const appointmentType = pgEnum("appointment_type", [
  "ONLINE",
  "IN_PERSON",
]);

export const appointmentStatus = pgEnum("appointment_status", [
  "REQUESTED",
  "CONFIRMED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

export const paymentStatus = pgEnum("payment_status", [
  "UNPAID",
  "REQUESTED",
  "PAID",
  "WAIVED",
  "REFUNDED",
]);

export const relationshipType = pgEnum("relationship_type", [
  "PRIMARY_PHYSICIAN",
  "DERMATOLOGIST",
  "CARDIOLOGIST",
  "DENTIST",
  "PSYCHIATRIST",
  "OTHER",
]);

// --- Phase 2 tables (DATABASE_SCHEMA_SPEC §8, §11, §22, §23.1) ---

/**
 * §8 — one row per patient↔doctor care relationship.
 * `status` is text per spec; app vocabulary 'ACTIVE' | 'ENDED'.
 */
export const patientDoctorRelationships = pgTable(
  "patient_doctor_relationships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    relationshipType: relationshipType("relationship_type").notNull(),
    isPreferred: boolean("is_preferred").notNull().default(false),
    status: text("status").notNull().default("ACTIVE"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("pdr_patient_doctor_idx").on(t.patientId, t.doctorId),
    uniqueIndex("pdr_unique_idx").on(
      t.patientId,
      t.doctorId,
      t.relationshipType,
      t.status,
    ),
  ],
);

/** §11 — encounters are the central clinical unit. */
export const encounters = pgTable(
  "encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterType: encounterType("encounter_type").notNull(),
    status: encounterStatus("status").notNull().default("OPEN"),
    chiefConcern: text("chief_concern"),
    initiatedByActorType: actorType("initiated_by_actor_type").notNull(),
    initiatedByActorId: uuid("initiated_by_actor_id"),
    relatedDoctorId: uuid("related_doctor_id").references(() => doctors.id),
    relatedPracticeId: uuid("related_practice_id").references(
      (): AnyPgColumn => practices.id,
    ),
    parentEncounterId: uuid("parent_encounter_id").references(
      (): AnyPgColumn => encounters.id,
    ),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("encounters_patient_started_idx").on(t.patientId, t.startedAt),
    index("encounters_doctor_started_idx").on(t.relatedDoctorId, t.startedAt),
  ],
);

/** §22 — appointments with §22 indexes. */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    practiceId: uuid("practice_id").references((): AnyPgColumn => practices.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    appointmentType: appointmentType("appointment_type").notNull(),
    status: appointmentStatus("status").notNull().default("REQUESTED"),
    scheduledStart: timestamp("scheduled_start", {
      withTimezone: true,
    }).notNull(),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    reason: text("reason"),
    meetingProvider: text("meeting_provider"),
    meetingReference: text("meeting_reference"),
    paymentStatus: paymentStatus("payment_status").notNull().default("UNPAID"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("appointments_doctor_start_idx").on(t.doctorId, t.scheduledStart),
    index("appointments_patient_start_idx").on(t.patientId, t.scheduledStart),
    index("appointments_status_start_idx").on(t.status, t.scheduledStart),
  ],
);

/** §23.1 — manual payment tracking audit trail (pulled forward from Phase 3). */
export const paymentEvents = pgTable("payment_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id")
    .notNull()
    .references(() => appointments.id),
  oldStatus: paymentStatus("old_status"),
  newStatus: paymentStatus("new_status").notNull(),
  markedByProfileId: uuid("marked_by_profile_id")
    .notNull()
    .references(() => profiles.id),
  referenceNote: text("reference_note"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Documented contract extension — source of truth for §14 availability.
 * Slots apply saved calendar rules to working windows, then exclude breaks and booked appointments.
 */
export const doctorAvailability = pgTable("doctor_availability", {
  doctorId: uuid("doctor_id")
    .primaryKey()
    .references(() => doctors.id),
  weeklyTemplate: jsonb("weekly_template")
    .$type<{ day_of_week: number; start_time: string; end_time: string }[]>()
    .notNull(),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
  rules: jsonb("rules").$type<AvailabilityRules>().notNull().default({ breaks: [], blocked_dates: [], overrides: [], online_template: null }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ponytail: phone_hash duplicate check (§41/Screen 22) works via a plain
// `where phone_hash = hashIdentity(mobile)` full scan at prototype scale.
// Add a DB index when directories grow — drizzle's standalone index API
// chokes on a nullable plain `text` column (no ExtraConfigColumn mixin).

// --- Phase 3 enums (DATABASE_SCHEMA_SPEC §3) ---

export const prescriptionDraftSource = pgEnum("prescription_draft_source", [
  "DIRECT_ENTRY",
  "OCR",
  "VOICE",
]);

export const prescriptionDraftStatus = pgEnum("prescription_draft_status", [
  "DRAFT",
  "NEEDS_REVIEW",
  "APPROVED",
  "REJECTED",
  "EXPIRED",
]);

export const prescriptionStatus = pgEnum("prescription_status", [
  "ACTIVE",
  "SUPERSEDED",
  "CANCELLED",
]);

// --- Phase 3 tables (DATABASE_SCHEMA_SPEC §9, §18–§21, §26.1) ---

/**
 * §18.1 — one row per prescription draft, regardless of source mode.
 * `source_document_id` now carries its FK (documents landed in Phase 4);
 * `source_audio_document_id` still has none (voice arrives Phase 8+).
 */
export const prescriptionDrafts = pgTable(
  "prescription_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    source: prescriptionDraftSource("source").notNull(),
    status: prescriptionDraftStatus("status").notNull().default("DRAFT"),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id),
    sourceAudioDocumentId: uuid("source_audio_document_id"),
    rawTranscript: text("raw_transcript"),
    rawExtraction: jsonb("raw_extraction"),
    overallConfidence: numeric("overall_confidence"),
    riskFlags: jsonb("risk_flags"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [index("prescription_drafts_doctor_status_idx").on(t.doctorId, t.status, t.createdAt)],
);

/** §18.2 — medicine lines on a draft. `needs_review` is Phase 4's OCR guard. */
export const prescriptionDraftItems = pgTable(
  "prescription_draft_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => prescriptionDrafts.id),
    sequenceNumber: integer("sequence_number").notNull(),
    medicineName: text("medicine_name").notNull(),
    strength: text("strength"),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    timing: text("timing"),
    duration: text("duration"),
    instructions: text("instructions"),
    fieldConfidence: jsonb("field_confidence"),
    needsReview: boolean("needs_review").notNull().default(true),
    reviewedByDoctorId: uuid("reviewed_by_doctor_id").references(() => doctors.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prescription_draft_items_draft_idx").on(t.draftId, t.sequenceNumber)],
);

/**
 * §19.1 — logical prescription. `current_version_id` references
 * `prescription_versions.id`; the circular reference is emitted by drizzle-kit
 * as a post-create ALTER (same pattern as `encounters.parent_encounter_id`).
 */
export const prescriptions = pgTable(
  "prescriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    status: prescriptionStatus("status").notNull().default("ACTIVE"),
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => prescriptionVersions.id,
    ),
    createdFromDraftId: uuid("created_from_draft_id").references(
      () => prescriptionDrafts.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prescriptions_patient_created_idx").on(t.patientId, t.createdAt)],
);

/**
 * §19.2 — immutable versions. The UNIQUE(prescription_id, version_number)
 * constraint is the immutability anchor: two versions can never share a number.
 */
export const prescriptionVersions = pgTable(
  "prescription_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prescriptionId: uuid("prescription_id")
      .notNull()
      .references(() => prescriptions.id),
    versionNumber: integer("version_number").notNull(),
    amendmentReason: text("amendment_reason"),
    finalizedByDoctorId: uuid("finalized_by_doctor_id")
      .notNull()
      .references(() => doctors.id),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull(),
    supersedesVersionId: uuid("supersedes_version_id").references(
      (): AnyPgColumn => prescriptionVersions.id,
    ),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("prescription_versions_unique_idx").on(
      t.prescriptionId,
      t.versionNumber,
    ),
    index("prescription_versions_prescription_idx").on(t.prescriptionId),
  ],
);

/** §19.3 — items hang off the VERSION, not the prescription. */
export const prescriptionItems = pgTable(
  "prescription_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prescriptionVersionId: uuid("prescription_version_id")
      .notNull()
      .references(() => prescriptionVersions.id),
    sequenceNumber: integer("sequence_number").notNull(),
    medicineName: text("medicine_name").notNull(),
    medicineCode: text("medicine_code"),
    strength: text("strength"),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    timing: text("timing"),
    duration: text("duration"),
    instructions: text("instructions"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("prescription_items_version_idx").on(t.prescriptionVersionId, t.sequenceNumber)],
);

/**
 * §20.1 — actual medication exposure/history. `status` is free text per spec.
 * `provenance_id` carries no FK: `provenance_records` is not built yet
 * (ponytail: add FK when Phase 5/6 provenance lands).
 */
export const medicationRecords = pgTable(
  "medication_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    prescriptionId: uuid("prescription_id").references(() => prescriptions.id),
    prescriptionItemId: uuid("prescription_item_id").references(
      () => prescriptionItems.id,
    ),
    medicineName: text("medicine_name").notNull(),
    medicineCode: text("medicine_code"),
    dose: text("dose"),
    route: text("route"),
    frequency: text("frequency"),
    startedOn: date("started_on"),
    endedOn: date("ended_on"),
    reasonForUse: text("reason_for_use"),
    response: text("response"),
    adverseReaction: text("adverse_reaction"),
    reasonStopped: text("reason_stopped"),
    status: text("status").notNull(),
    provenanceId: uuid("provenance_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("medication_records_patient_idx").on(t.patientId)],
);

/**
 * §21.1 — doctor-authored consultation notes. One row per encounter; post-final
 * edits insert amendment rows (note_type 'CONSULTATION_AMENDMENT') rather than
 * touching the original. No `consultation_note_versions` table (spec optional).
 */
export const consultationNotes = pgTable(
  "consultation_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    doctorId: uuid("doctor_id")
      .notNull()
      .references(() => doctors.id),
    noteType: text("note_type").notNull(),
    content: text("content").notNull(),
    isFinal: boolean("is_final").notNull().default(false),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("consultation_notes_encounter_idx").on(t.encounterId)],
);

/** §9.1 — claim invites. Raw token never stored; only the keyed hash. */
export const patientClaimInvites = pgTable(
  "patient_claim_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    phoneHash: text("phone_hash"),
    inviteTokenHash: text("invite_token_hash").notNull(),
    createdByProfileId: uuid("created_by_profile_id")
      .notNull()
      .references(() => profiles.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    status: text("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("patient_claim_invites_token_idx").on(t.inviteTokenHash)],
);

/** §9.2 — claim attempt audit trail. */
export const patientClaimEvents = pgTable("patient_claim_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  patientId: uuid("patient_id")
    .notNull()
    .references(() => patients.id),
  profileId: uuid("profile_id")
    .notNull()
    .references(() => profiles.id),
  inviteId: uuid("invite_id").references(() => patientClaimInvites.id),
  eventType: text("event_type").notNull(),
  success: boolean("success").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const consentStatus = pgEnum("consent_status", ["ACTIVE", "REVOKED", "EXPIRED"]);

/**
 * §25.1 — patient-granted, time-boxed sharing authorization. `status` is
 * stored, but an ACTIVE row past `expires_at` is treated as expired at read
 * time (see privacy/consent.ts); there is no expiry job.
 */
export const consents = pgTable(
  "consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    granteeType: actorType("grantee_type").notNull(),
    granteeId: uuid("grantee_id").notNull(),
    purpose: text("purpose").notNull(),
    status: consentStatus("status").notNull().default("ACTIVE"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("consents_patient_status_idx").on(t.patientId, t.status),
    index("consents_grantee_status_idx").on(t.granteeType, t.granteeId, t.status),
  ],
);

/** §25.2 — explicit resource scopes of one consent (prefer resource ids). */
export const consentScopes = pgTable(
  "consent_scopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    consentId: uuid("consent_id")
      .notNull()
      .references(() => consents.id),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    resourceFilter: jsonb("resource_filter"),
    permission: text("permission").notNull().default("READ"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("consent_scopes_consent_idx").on(t.consentId)],
);

/**
 * §27.1 — patient request to remove a record from active views. `status`
 * vocabulary: OPEN | ROUTED | APPROVED | PARTIALLY_APPROVED | DENIED.
 * `decisions` holds the per-record REMOVE/RETAIN outcome of a resolution.
 */
export const recordRemovalRequests = pgTable(
  "record_removal_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    targetActorType: actorType("target_actor_type").notNull(),
    targetActorId: uuid("target_actor_id"),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    reason: text("reason"),
    status: text("status").notNull().default("OPEN"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    routedByProfileId: uuid("routed_by_profile_id").references(() => profiles.id),
    routedAt: timestamp("routed_at", { withTimezone: true }),
    routingNote: text("routing_note"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNote: text("resolution_note"),
    resolvedByProfileId: uuid("resolved_by_profile_id").references(() => profiles.id),
    decisions: jsonb("decisions"),
  },
  (t) => [
    index("rrr_patient_idx").on(t.patientId, t.status),
    index("rrr_target_idx").on(t.targetActorType, t.targetActorId, t.status),
  ],
);

/**
 * §26.1 — append-only access ledger. Application roles INSERT only (UPDATE and
 * DELETE are revoked in migration 0012); no UPDATE/DELETE code path exists.
 */
export const accessEvents = pgTable(
  "access_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    actorType: actorType("actor_type").notNull(),
    actorId: uuid("actor_id"),
    purpose: text("purpose"),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id"),
    action: text("action").notNull(),
    consentId: uuid("consent_id").references(() => consents.id),
    requestId: text("request_id"),
    ipHash: text("ip_hash"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("access_events_patient_created_idx").on(t.patientId, t.createdAt),
    index("access_events_actor_created_idx").on(t.actorType, t.actorId, t.createdAt),
  ],
);

// --- Phase 4 enums (DATABASE_SCHEMA_SPEC §3) ---

export const documentType = pgEnum("document_type", [
  "LAB_REPORT",
  "PRESCRIPTION",
  "IMAGING_REPORT",
  "DISCHARGE_SUMMARY",
  "CONSULTATION_NOTE",
  "OTHER",
]);

export const documentProcessingStatus = pgEnum("document_processing_status", [
  "UPLOADED",
  "PROCESSING",
  "NEEDS_REVIEW",
  "COMPLETE",
  "FAILED",
]);

// --- Phase 4 tables (DATABASE_SCHEMA_SPEC §16–§17) ---

/**
 * §16.1 — metadata only; the binary lives in private object storage
 * (`clinix-documents` bucket). Never store public object URLs.
 * `uploaded_by_actor_id` carries the domain id for the actor type:
 * patients.id for PATIENT, doctors.id for DOCTOR.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    documentType: documentType("document_type").notNull(),
    storageBucket: text("storage_bucket").notNull(),
    storageObjectKey: text("storage_object_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    fileSizeBytes: bigint("file_size_bytes", { mode: "number" }),
    sha256: text("sha256"),
    uploadedByActorType: actorType("uploaded_by_actor_type").notNull(),
    uploadedByActorId: uuid("uploaded_by_actor_id"),
    processingStatus: documentProcessingStatus("processing_status")
      .notNull()
      .default("UPLOADED"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("documents_patient_created_idx").on(t.patientId, t.createdAt)],
);

/** §16.2 — one row per extraction attempt on a document. */
export const documentExtractions = pgTable("document_extractions", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  extractorType: text("extractor_type").notNull(),
  extractorVersion: text("extractor_version"),
  rawText: text("raw_text"),
  structuredPayload: jsonb("structured_payload"),
  confidence: numeric("confidence"),
  status: text("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedByProfileId: uuid("reviewed_by_profile_id").references(
    () => profiles.id,
  ),
});

/**
 * §17.1 — a structured lab report derived from a source document.
 * `provenance_id` carries no FK: `provenance_records` is not built yet
 * (ponytail: add FK when Phase 5/6 provenance lands).
 */
export const labReports = pgTable(
  "lab_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    laboratoryName: text("laboratory_name"),
    collectionDate: date("collection_date"),
    reportDate: date("report_date"),
    provenanceId: uuid("provenance_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("lab_reports_patient_created_idx").on(t.patientId, t.createdAt)],
);

/**
 * §17.2 — individual lab values. `confirmed_at`/`confirmed_by_profile_id` are a
 * documented contract extension for Screen 9's "correction or confirmation"
 * path (patient confirms/corrects a low-confidence value).
 */
export const labObservations = pgTable(
  "lab_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    labReportId: uuid("lab_report_id")
      .notNull()
      .references(() => labReports.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    testCode: text("test_code"),
    testName: text("test_name").notNull(),
    valueNumeric: numeric("value_numeric"),
    valueText: text("value_text"),
    unit: text("unit"),
    referenceLow: numeric("reference_low"),
    referenceHigh: numeric("reference_high"),
    referenceText: text("reference_text"),
    flag: text("flag"),
    // Documented deviation: DB §17.2 has no confidence column, but API §12 returns
    // per-observation confidence (drives NEEDS_REVIEW + the Screen 9 badge). Stored
    // here from the OCR extraction rather than looked up from structured_payload.
    confidence: numeric("confidence"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    provenanceId: uuid("provenance_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByProfileId: uuid("confirmed_by_profile_id").references(
      () => profiles.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("lab_observations_patient_test_obs_idx").on(
      t.patientId,
      t.testName,
      t.observedAt.desc(),
    ),
    index("lab_observations_patient_code_obs_idx").on(
      t.patientId,
      t.testCode,
      t.observedAt.desc(),
    ),
  ],
);

// --- Phase 5 enums (DATABASE_SCHEMA_SPEC §7) ---

export const aiRole = pgEnum("ai_role", [
  "ANALYST_1",
  "ANALYST_2",
  "JUDGE",
  "OUTPUT_COMPOSER",
]);

export const aiRunStatus = pgEnum("ai_run_status", [
  "QUEUED",
  "RUNNING",
  "SUCCEEDED",
  "FAILED",
  "BLOCKED",
]);

// --- Phase 5 tables (DATABASE_SCHEMA_SPEC §12, §28–§31) ---

/**
 * §12.1 — interactive questioning session linked to an encounter.
 */
export const interactionSessions = pgTable("interaction_sessions", {
  safetyAlert: jsonb("safety_alert"),
  id: uuid("id").primaryKey().defaultRandom(),
  encounterId: uuid("encounter_id")
    .notNull()
    .references(() => encounters.id),
  status: text("status").notNull().default("IN_PROGRESS"),
  currentStep: integer("current_step").notNull().default(1),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

/**
 * §12.2 — adaptive question blocks presented to the patient.
 */
export const interactionBlocks = pgTable("interaction_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  interactionSessionId: uuid("interaction_session_id")
    .notNull()
    .references(() => interactionSessions.id),
  sequenceNumber: integer("sequence_number").notNull(),
  blockType: text("block_type").notNull(),
  title: text("title").notNull(),
  helpText: text("help_text"),
  options: jsonb("options"),
  allowFreeText: boolean("allow_free_text").notNull().default(true),
  generatedByAiSessionId: uuid("generated_by_ai_session_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §12.3 — patient answers to adaptive blocks.
 */
export const interactionResponses = pgTable(
  "interaction_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    interactionBlockId: uuid("interaction_block_id")
      .notNull()
      .references(() => interactionBlocks.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    selectedOptionIds: jsonb("selected_option_ids"),
    freeText: text("free_text"),
    numericValue: numeric("numeric_value"),
    dateValue: date("date_value"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("interaction_responses_block_idx").on(t.interactionBlockId)],
);

/**
 * §28.1 — AI orchestration session tracking multi-analyst and judge execution.
 */
export const aiSessions = pgTable(
  "ai_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    purpose: text("purpose").notNull(),
    patientOutcome: jsonb("patient_outcome"),
    status: aiRunStatus("status").notNull().default("QUEUED"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_sessions_patient_enc_idx").on(t.patientId, t.encounterId)],
);

/**
 * §28.2 — frozen canonical patient context bundle stripped of direct identifiers.
 * Enforces contains_direct_identifiers = false.
 */
export const aiEvidenceBundles = pgTable("ai_evidence_bundles", {
  id: uuid("id").primaryKey().defaultRandom(),
  aiSessionId: uuid("ai_session_id")
    .notNull()
    .references(() => aiSessions.id),
  bundleVersion: integer("bundle_version").notNull().default(1),
  payload: jsonb("payload").notNull(),
  payloadHash: text("payload_hash").notNull(),
  containsDirectIdentifiers: boolean("contains_direct_identifiers")
    .notNull()
    .default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §28.3 — individual model runs for Analyst 1, Analyst 2, and Judge.
 */
export const aiModelRuns = pgTable(
  "ai_model_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiSessionId: uuid("ai_session_id")
      .notNull()
      .references(() => aiSessions.id),
    role: aiRole("role").notNull(),
    providerRoute: text("provider_route").notNull(),
    modelName: text("model_name").notNull(),
    inputHash: text("input_hash").notNull(),
    outputPayload: jsonb("output_payload"),
    outputHash: text("output_hash"),
    status: aiRunStatus("status").notNull().default("QUEUED"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_model_runs_session_role_idx").on(t.aiSessionId, t.role)],
);

/**
 * §28.4 — Judge synthesis: agreements, material disagreements, and safe consensus.
 */
export const aiJudgments = pgTable(
  "ai_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    aiSessionId: uuid("ai_session_id")
      .notNull()
      .references(() => aiSessions.id),
    agreements: jsonb("agreements").notNull(),
    materialDisagreements: jsonb("material_disagreements").notNull(),
    unsupportedClaims: jsonb("unsupported_claims").notNull(),
    questionsToAskNext: jsonb("questions_to_ask_next").notNull(),
    safeConsensus: jsonb("safe_consensus").notNull(),
    requiresDoctorReview: boolean("requires_doctor_review")
      .notNull()
      .default(false),
    requiresUrgentEscalation: boolean("requires_urgent_escalation")
      .notNull()
      .default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("ai_judgments_session_idx").on(t.aiSessionId)],
);

/**
 * §29.1 — AI-derived historical episode matches (STRONGLY/PARTIALLY/INSUFFICIENTLY_SIMILAR).
 */
export const aiHistoricalMatches = pgTable("ai_historical_matches", {
  id: uuid("id").primaryKey().defaultRandom(),
  aiSessionId: uuid("ai_session_id")
    .notNull()
    .references(() => aiSessions.id),
  currentEncounterId: uuid("current_encounter_id")
    .notNull()
    .references(() => encounters.id),
  historicalEncounterId: uuid("historical_encounter_id")
    .notNull()
    .references(() => encounters.id),
  similarityLabel: text("similarity_label").notNull(),
  similarityScore: numeric("similarity_score"),
  supportingFeatures: jsonb("supporting_features"),
  differences: jsonb("differences"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §30.1 — semantic chunks with pgvector embeddings for longitudinal similarity search.
 */
export const semanticChunks = pgTable(
  "semantic_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    chunkText: text("chunk_text").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("semantic_chunks_patient_source_idx").on(t.patientId, t.sourceType)],
);

/**
 * §31.1 — deterministic safety evaluations logged at PRE_AI and POST_JUDGE stages.
 */
export const safetyEvaluations = pgTable(
  "safety_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    encounterId: uuid("encounter_id")
      .notNull()
      .references(() => encounters.id),
    aiSessionId: uuid("ai_session_id").references(() => aiSessions.id),
    stage: text("stage").notNull(),
    triggeredRuleIds: jsonb("triggered_rule_ids").notNull(),
    severity: text("severity").notNull(),
    action: text("action").notNull(),
    inputHash: text("input_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("safety_evaluations_enc_idx").on(t.encounterId)],
);

// --- Phase 7: staff & practice OS ---

/** §7.1 — a clinic/practice. Created by a doctor, who becomes its OWNER. */
export const practices = pgTable("practices", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone"),
  address: text("address"),
  createdByDoctorId: uuid("created_by_doctor_id").references(() => doctors.id),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * §7.2 — membership of a profile in a practice. Staff access exists only while
 * status = ACTIVE. An invitation row has no profile until it is accepted; the
 * invite token is stored only as a SHA-256 hash. role: OWNER | DOCTOR |
 * RECEPTION | ASSISTANT. status: INVITED | ACTIVE | SUSPENDED | FORMER | REVOKED.
 */
export const practiceMembers = pgTable(
  "practice_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    practiceId: uuid("practice_id")
      .notNull()
      .references(() => practices.id),
    profileId: uuid("profile_id").references(() => profiles.id),
    role: text("role").notNull(),
    status: text("status").notNull().default("INVITED"),
    inviteContactHash: text("invite_contact_hash"),
    inviteContactHint: text("invite_contact_hint"),
    inviteTokenHash: text("invite_token_hash").unique(),
    inviteExpiresAt: timestamp("invite_expires_at", { withTimezone: true }),
    invitedByProfileId: uuid("invited_by_profile_id").references(
      () => profiles.id,
    ),
    assignedDoctorId: uuid("assigned_doctor_id").references(() => doctors.id),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("practice_members_practice_idx").on(t.practiceId, t.status),
    index("practice_members_profile_idx").on(t.profileId, t.status),
  ],
);

/**
 * §24.1 extended — a follow-up obligation. Distinct from a booked appointment:
 * completing a follow-up never implies the visit was attended. `outcome` is
 * written by doctors only. status: OPEN | COMPLETED | CANCELLED;
 * contactStatus: UNREACHED | REACHED.
 */
export const followups = pgTable(
  "followups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    doctorId: uuid("doctor_id").references(() => doctors.id),
    practiceId: uuid("practice_id").references(() => practices.id),
    sourceEncounterId: uuid("source_encounter_id")
      .notNull()
      .references(() => encounters.id),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("OPEN"),
    assignedMemberId: uuid("assigned_member_id").references(
      () => practiceMembers.id,
    ),
    contactStatus: text("contact_status").notNull().default("UNREACHED"),
    outcome: text("outcome"),
    completedByProfileId: uuid("completed_by_profile_id").references(
      () => profiles.id,
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("followups_doctor_due_idx").on(t.doctorId, t.status, t.dueAt),
    index("followups_patient_idx").on(t.patientId),
    index("followups_practice_due_idx").on(t.practiceId, t.status, t.dueAt),
  ],
);

/** §32.1 — in-app notifications. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientProfileId: uuid("recipient_profile_id")
      .notNull()
      .references(() => profiles.id),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    relatedResourceType: text("related_resource_type"),
    relatedResourceId: uuid("related_resource_id"),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientProfileId, t.readAt)],
);

/**
 * Operational intake state for one appointment, kept out of appointment_status
 * so the Phase 3 clinical flow is unchanged. status: ARRIVED | WAITING |
 * READY_FOR_DOCTOR.
 */
export const appointmentIntakes = pgTable("appointment_intakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  appointmentId: uuid("appointment_id")
    .notNull()
    .unique()
    .references(() => appointments.id),
  practiceId: uuid("practice_id").references(() => practices.id),
  status: text("status").notNull(),
  arrivedAt: timestamp("arrived_at", { withTimezone: true }),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  intakeNote: text("intake_note"),
  updatedByProfileId: uuid("updated_by_profile_id").references(
    () => profiles.id,
  ),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Staff-entered vitals for an encounter. Provenance is always CLINIC_STAFF
 * (or DOCTOR when the doctor enters them); `needsDoctorReview` flags out-of-range
 * values with no diagnostic meaning.
 */
export const intakeVitals = pgTable(
  "intake_vitals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    appointmentId: uuid("appointment_id")
      .notNull()
      .references(() => appointments.id),
    encounterId: uuid("encounter_id").references(() => encounters.id),
    patientId: uuid("patient_id")
      .notNull()
      .references(() => patients.id),
    temperatureC: numeric("temperature_c"),
    pulseBpm: integer("pulse_bpm"),
    systolicMmhg: integer("systolic_mmhg"),
    diastolicMmhg: integer("diastolic_mmhg"),
    spo2Percent: integer("spo2_percent"),
    weightKg: numeric("weight_kg"),
    needsDoctorReview: boolean("needs_doctor_review").notNull().default(false),
    provenance: text("provenance").notNull().default("CLINIC_STAFF"),
    enteredByProfileId: uuid("entered_by_profile_id")
      .notNull()
      .references(() => profiles.id),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("intake_vitals_appt_idx").on(t.appointmentId)],
);

/** Doctor-editable public profile and consultation services (Page 27). */
export const doctorProfiles = pgTable("doctor_profiles", {
  doctorId: uuid("doctor_id")
    .primaryKey()
    .references(() => doctors.id),
  bio: text("bio"),
  languages: jsonb("languages").notNull().default([]),
  visitDurationMinutes: integer("visit_duration_minutes"),
  services: jsonb("services").notNull().default([]),
  acceptingAppointments: boolean("accepting_appointments")
    .notNull()
    .default(true),
  directoryVisible: boolean("directory_visible").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
