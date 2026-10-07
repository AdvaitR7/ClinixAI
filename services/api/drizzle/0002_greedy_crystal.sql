CREATE TYPE "public"."prescription_draft_source" AS ENUM('DIRECT_ENTRY', 'OCR', 'VOICE');--> statement-breakpoint
CREATE TYPE "public"."prescription_draft_status" AS ENUM('DRAFT', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED', 'EXPIRED');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('ACTIVE', 'SUPERSEDED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "access_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_id" uuid,
	"purpose" text,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"action" text NOT NULL,
	"consent_id" uuid,
	"request_id" text,
	"ip_hash" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consultation_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"note_type" text NOT NULL,
	"content" text NOT NULL,
	"is_final" boolean DEFAULT false NOT NULL,
	"finalized_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"prescription_id" uuid,
	"prescription_item_id" uuid,
	"medicine_name" text NOT NULL,
	"medicine_code" text,
	"dose" text,
	"route" text,
	"frequency" text,
	"started_on" date,
	"ended_on" date,
	"reason_for_use" text,
	"response" text,
	"adverse_reaction" text,
	"reason_stopped" text,
	"status" text NOT NULL,
	"provenance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_claim_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"invite_id" uuid,
	"event_type" text NOT NULL,
	"success" boolean NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patient_claim_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"phone_hash" text,
	"invite_token_hash" text NOT NULL,
	"created_by_profile_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_draft_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"medicine_name" text NOT NULL,
	"strength" text,
	"dose" text,
	"route" text,
	"frequency" text,
	"timing" text,
	"duration" text,
	"instructions" text,
	"field_confidence" jsonb,
	"needs_review" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"doctor_id" uuid NOT NULL,
	"source" "prescription_draft_source" NOT NULL,
	"status" "prescription_draft_status" DEFAULT 'DRAFT' NOT NULL,
	"source_document_id" uuid,
	"source_audio_document_id" uuid,
	"raw_transcript" text,
	"raw_extraction" jsonb,
	"overall_confidence" numeric,
	"risk_flags" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_version_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"medicine_name" text NOT NULL,
	"medicine_code" text,
	"strength" text,
	"dose" text,
	"route" text,
	"frequency" text,
	"timing" text,
	"duration" text,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"amendment_reason" text,
	"finalized_by_doctor_id" uuid NOT NULL,
	"finalized_at" timestamp with time zone NOT NULL,
	"supersedes_version_id" uuid,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"status" "prescription_status" DEFAULT 'ACTIVE' NOT NULL,
	"current_version_id" uuid,
	"created_from_draft_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consultation_notes" ADD CONSTRAINT "consultation_notes_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_records" ADD CONSTRAINT "medication_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_records" ADD CONSTRAINT "medication_records_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_records" ADD CONSTRAINT "medication_records_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_records" ADD CONSTRAINT "medication_records_prescription_item_id_prescription_items_id_fk" FOREIGN KEY ("prescription_item_id") REFERENCES "public"."prescription_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_claim_events" ADD CONSTRAINT "patient_claim_events_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_claim_events" ADD CONSTRAINT "patient_claim_events_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_claim_events" ADD CONSTRAINT "patient_claim_events_invite_id_patient_claim_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."patient_claim_invites"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_claim_invites" ADD CONSTRAINT "patient_claim_invites_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patient_claim_invites" ADD CONSTRAINT "patient_claim_invites_created_by_profile_id_profiles_id_fk" FOREIGN KEY ("created_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_draft_items" ADD CONSTRAINT "prescription_draft_items_draft_id_prescription_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."prescription_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_drafts" ADD CONSTRAINT "prescription_drafts_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_drafts" ADD CONSTRAINT "prescription_drafts_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_drafts" ADD CONSTRAINT "prescription_drafts_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_version_id_prescription_versions_id_fk" FOREIGN KEY ("prescription_version_id") REFERENCES "public"."prescription_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_finalized_by_doctor_id_doctors_id_fk" FOREIGN KEY ("finalized_by_doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_versions" ADD CONSTRAINT "prescription_versions_supersedes_version_id_prescription_versions_id_fk" FOREIGN KEY ("supersedes_version_id") REFERENCES "public"."prescription_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_current_version_id_prescription_versions_id_fk" FOREIGN KEY ("current_version_id") REFERENCES "public"."prescription_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_created_from_draft_id_prescription_drafts_id_fk" FOREIGN KEY ("created_from_draft_id") REFERENCES "public"."prescription_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "access_events_patient_created_idx" ON "access_events" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "access_events_actor_created_idx" ON "access_events" USING btree ("actor_type","actor_id","created_at");--> statement-breakpoint
CREATE INDEX "consultation_notes_encounter_idx" ON "consultation_notes" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "medication_records_patient_idx" ON "medication_records" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "patient_claim_invites_token_idx" ON "patient_claim_invites" USING btree ("invite_token_hash");--> statement-breakpoint
CREATE INDEX "prescription_draft_items_draft_idx" ON "prescription_draft_items" USING btree ("draft_id","sequence_number");--> statement-breakpoint
CREATE INDEX "prescription_drafts_doctor_status_idx" ON "prescription_drafts" USING btree ("doctor_id","status","created_at");--> statement-breakpoint
CREATE INDEX "prescription_items_version_idx" ON "prescription_items" USING btree ("prescription_version_id","sequence_number");--> statement-breakpoint
CREATE UNIQUE INDEX "prescription_versions_unique_idx" ON "prescription_versions" USING btree ("prescription_id","version_number");--> statement-breakpoint
CREATE INDEX "prescription_versions_prescription_idx" ON "prescription_versions" USING btree ("prescription_id");--> statement-breakpoint
CREATE INDEX "prescriptions_patient_created_idx" ON "prescriptions" USING btree ("patient_id","created_at");