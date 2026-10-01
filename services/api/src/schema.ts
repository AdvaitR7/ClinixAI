import {
  customType,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
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
