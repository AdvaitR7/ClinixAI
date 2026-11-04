CREATE TABLE "appointment_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"practice_id" uuid,
	"status" text NOT NULL,
	"arrived_at" timestamp with time zone,
	"ready_at" timestamp with time zone,
	"intake_note" text,
	"updated_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointment_intakes_appointment_id_unique" UNIQUE("appointment_id")
);
--> statement-breakpoint
CREATE TABLE "doctor_profiles" (
	"doctor_id" uuid PRIMARY KEY NOT NULL,
	"bio" text,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visit_duration_minutes" integer,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accepting_appointments" boolean DEFAULT true NOT NULL,
	"directory_visible" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid,
	"practice_id" uuid,
	"source_encounter_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"assigned_member_id" uuid,
	"contact_status" text DEFAULT 'UNREACHED' NOT NULL,
	"outcome" text,
	"completed_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "intake_vitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"encounter_id" uuid,
	"patient_id" uuid NOT NULL,
	"temperature_c" numeric,
	"pulse_bpm" integer,
	"systolic_mmhg" integer,
	"diastolic_mmhg" integer,
	"spo2_percent" integer,
	"weight_kg" numeric,
	"needs_doctor_review" boolean DEFAULT false NOT NULL,
	"provenance" text DEFAULT 'CLINIC_STAFF' NOT NULL,
	"entered_by_profile_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_profile_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"related_resource_type" text,
	"related_resource_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"practice_id" uuid NOT NULL,
	"profile_id" uuid,
	"role" text NOT NULL,
	"status" text DEFAULT 'INVITED' NOT NULL,
	"invite_contact_hash" text,
	"invite_contact_hint" text,
	"invite_token_hash" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by_profile_id" uuid,
	"assigned_doctor_id" uuid,
	"effective_from" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "practice_members_invite_token_hash_unique" UNIQUE("invite_token_hash")
);
--> statement-breakpoint
CREATE TABLE "practices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"address" text,
	"created_by_doctor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointment_intakes" ADD CONSTRAINT "appointment_intakes_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_intakes" ADD CONSTRAINT "appointment_intakes_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_intakes" ADD CONSTRAINT "appointment_intakes_updated_by_profile_id_profiles_id_fk" FOREIGN KEY ("updated_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_profiles" ADD CONSTRAINT "doctor_profiles_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_source_encounter_id_encounters_id_fk" FOREIGN KEY ("source_encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_assigned_member_id_practice_members_id_fk" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."practice_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followups" ADD CONSTRAINT "followups_completed_by_profile_id_profiles_id_fk" FOREIGN KEY ("completed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_vitals" ADD CONSTRAINT "intake_vitals_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_vitals" ADD CONSTRAINT "intake_vitals_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_vitals" ADD CONSTRAINT "intake_vitals_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "intake_vitals" ADD CONSTRAINT "intake_vitals_entered_by_profile_id_profiles_id_fk" FOREIGN KEY ("entered_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_profile_id_profiles_id_fk" FOREIGN KEY ("recipient_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_invited_by_profile_id_profiles_id_fk" FOREIGN KEY ("invited_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_members" ADD CONSTRAINT "practice_members_assigned_doctor_id_doctors_id_fk" FOREIGN KEY ("assigned_doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practices" ADD CONSTRAINT "practices_created_by_doctor_id_doctors_id_fk" FOREIGN KEY ("created_by_doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "followups_doctor_due_idx" ON "followups" USING btree ("doctor_id","status","due_at");--> statement-breakpoint
CREATE INDEX "followups_patient_idx" ON "followups" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "followups_practice_due_idx" ON "followups" USING btree ("practice_id","status","due_at");--> statement-breakpoint
CREATE INDEX "intake_vitals_appt_idx" ON "intake_vitals" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient_profile_id","read_at");--> statement-breakpoint
CREATE INDEX "practice_members_practice_idx" ON "practice_members" USING btree ("practice_id","status");--> statement-breakpoint
CREATE INDEX "practice_members_profile_idx" ON "practice_members" USING btree ("profile_id","status");--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_practice_id_practices_id_fk" FOREIGN KEY ("practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "encounters" ADD CONSTRAINT "encounters_related_practice_id_practices_id_fk" FOREIGN KEY ("related_practice_id") REFERENCES "public"."practices"("id") ON DELETE no action ON UPDATE no action;