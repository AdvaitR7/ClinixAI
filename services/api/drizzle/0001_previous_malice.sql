CREATE TYPE "public"."appointment_status" AS ENUM('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('ONLINE', 'IN_PERSON');--> statement-breakpoint
CREATE TYPE "public"."encounter_status" AS ENUM('OPEN', 'WAITING_FOR_PATIENT', 'WAITING_FOR_DOCTOR', 'COMPLETED', 'CANCELLED', 'ESCALATED');--> statement-breakpoint
CREATE TYPE "public"."encounter_type" AS ENUM('AI_SELF_CARE', 'DOCTOR_ONLINE', 'DOCTOR_IN_PERSON', 'FOLLOW_UP', 'RECORD_IMPORT');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('UNPAID', 'REQUESTED', 'PAID', 'WAIVED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."relationship_type" AS ENUM('PRIMARY_PHYSICIAN', 'DERMATOLOGIST', 'CARDIOLOGIST', 'DENTIST', 'PSYCHIATRIST', 'OTHER');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"practice_id" uuid,
	"encounter_id" uuid,
	"appointment_type" "appointment_type" NOT NULL,
	"status" "appointment_status" DEFAULT 'REQUESTED' NOT NULL,
	"scheduled_start" timestamp with time zone NOT NULL,
	"scheduled_end" timestamp with time zone,
	"reason" text,
	"meeting_provider" text,
	"meeting_reference" text,
	"payment_status" "payment_status" DEFAULT 'UNPAID' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_availability" (
	"doctor_id" uuid PRIMARY KEY NOT NULL,
	"weekly_template" jsonb NOT NULL,
	"slot_duration_minutes" integer DEFAULT 30 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "encounters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_type" "encounter_type" NOT NULL,
	"status" "encounter_status" DEFAULT 'OPEN' NOT NULL,
	"chief_concern" text,
	"initiated_by_actor_type" "actor_type" NOT NULL,
	"initiated_by_actor_id" uuid,
	"related_doctor_id" uuid,
	"related_practice_id" uuid,
	"parent_encounter_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_doctor_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"relationship_type" "relationship_type" NOT NULL,
	"is_preferred" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"old_status" "payment_status",
	"new_status" "payment_status" NOT NULL,
	"marked_by_profile_id" uuid NOT NULL,
	"reference_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_related_doctor_id_doctors_id_fk" FOREIGN KEY ("related_doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_parent_encounter_id_encounters_id_fk" FOREIGN KEY ("parent_encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_doctor_relationships" ADD CONSTRAINT "patient_doctor_relationships_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_marked_by_profile_id_profiles_id_fk" FOREIGN KEY ("marked_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_doctor_start_idx" ON "appointments" USING btree ("doctor_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "appointments_patient_start_idx" ON "appointments" USING btree ("patient_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "appointments_status_start_idx" ON "appointments" USING btree ("status","scheduled_start");--> statement-breakpoint
CREATE INDEX "encounters_patient_started_idx" ON "encounters" USING btree ("patient_id","started_at");--> statement-breakpoint
CREATE INDEX "encounters_doctor_started_idx" ON "encounters" USING btree ("related_doctor_id","started_at");--> statement-breakpoint
CREATE INDEX "pdr_patient_doctor_idx" ON "patient_doctor_relationships" USING btree ("patient_id","doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pdr_unique_idx" ON "patient_doctor_relationships" USING btree ("patient_id","doctor_id","relationship_type","status");