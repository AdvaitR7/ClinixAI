CREATE TYPE "public"."actor_type" AS ENUM('PATIENT', 'DOCTOR', 'CLINIC_STAFF', 'ADMIN', 'AI_SERVICE', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."doctor_verification_status" AS ENUM('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'SUSPENDED');--> statement-breakpoint
CREATE TYPE "public"."patient_status" AS ENUM('UNCLAIMED', 'ACTIVE', 'DEACTIVATED', 'DELETED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('PATIENT', 'DOCTOR', 'CLINIC_STAFF', 'ADMIN');--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" uuid NOT NULL,
	"registration_number" text NOT NULL,
	"registration_authority" text NOT NULL,
	"qualification" text,
	"speciality" text,
	"verification_status" "doctor_verification_status" DEFAULT 'PENDING' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doctors_profile_id_unique" UNIQUE("profile_id")
);
--> statement-breakpoint
CREATE TABLE "patient_identity" (
	"patient_id" uuid PRIMARY KEY NOT NULL,
	"full_name_encrypted" "bytea" NOT NULL,
	"phone_encrypted" "bytea" NOT NULL,
	"phone_hash" text,
	"email_encrypted" "bytea",
	"email_hash" text,
	"date_of_birth_encrypted" "bytea",
	"sex_at_registration" text,
	"address_encrypted" "bytea",
	"emergency_contact_encrypted" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_profile_id" uuid,
	"status" "patient_status" NOT NULL,
	"claimed_at" timestamp with time zone,
	"created_by_actor_type" "actor_type" NOT NULL,
	"created_by_actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_user_id" text,
	"primary_role" "user_role" NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profiles_clerk_user_id_unique" UNIQUE("clerk_user_id")
);
--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_identity" ADD CONSTRAINT "patient_identity_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_account_profile_id_profiles_id_fk" FOREIGN KEY ("account_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;