import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
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
  clerkUserId: text("clerk_user_id").unique(),
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
    relatedPracticeId: uuid("related_practice_id"),
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
    practiceId: uuid("practice_id"),
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
 * Slots = weekly template minus booked appointments.
 */
export const doctorAvailability = pgTable("doctor_availability", {
  doctorId: uuid("doctor_id")
    .primaryKey()
    .references(() => doctors.id),
  weeklyTemplate: jsonb("weekly_template")
    .$type<{ day_of_week: number; start_time: string; end_time: string }[]>()
    .notNull(),
  slotDurationMinutes: integer("slot_duration_minutes").notNull().default(30),
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
