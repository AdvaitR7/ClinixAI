CREATE TYPE "public"."document_processing_status" AS ENUM('UPLOADED', 'PROCESSING', 'NEEDS_REVIEW', 'COMPLETE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('LAB_REPORT', 'PRESCRIPTION', 'IMAGING_REPORT', 'DISCHARGE_SUMMARY', 'CONSULTATION_NOTE', 'OTHER');--> statement-breakpoint
CREATE TABLE "document_extractions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"extractor_type" text NOT NULL,
	"extractor_version" text,
	"raw_text" text,
	"structured_payload" jsonb,
	"confidence" numeric,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by_profile_id" uuid
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid,
	"document_type" "document_type" NOT NULL,
	"storage_bucket" text NOT NULL,
	"storage_object_key" text NOT NULL,
	"original_filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"file_size_bytes" bigint,
	"sha256" text,
	"uploaded_by_actor_type" "actor_type" NOT NULL,
	"uploaded_by_actor_id" uuid,
	"processing_status" "document_processing_status" DEFAULT 'UPLOADED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "lab_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lab_report_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"test_code" text,
	"test_name" text NOT NULL,
	"value_numeric" numeric,
	"value_text" text,
	"unit" text,
	"reference_low" numeric,
	"reference_high" numeric,
	"reference_text" text,
	"flag" text,
	"observed_at" timestamp with time zone,
	"provenance_id" uuid,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_profile_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lab_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"document_id" uuid NOT NULL,
	"encounter_id" uuid,
	"laboratory_name" text,
	"collection_date" date,
	"report_date" date,
	"provenance_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_extractions" ADD CONSTRAINT "document_extractions_reviewed_by_profile_id_profiles_id_fk" FOREIGN KEY ("reviewed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_observations" ADD CONSTRAINT "lab_observations_lab_report_id_lab_reports_id_fk" FOREIGN KEY ("lab_report_id") REFERENCES "public"."lab_reports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_observations" ADD CONSTRAINT "lab_observations_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_observations" ADD CONSTRAINT "lab_observations_confirmed_by_profile_id_profiles_id_fk" FOREIGN KEY ("confirmed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lab_reports" ADD CONSTRAINT "lab_reports_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_patient_created_idx" ON "documents" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "lab_observations_patient_test_obs_idx" ON "lab_observations" USING btree ("patient_id","test_name","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lab_observations_patient_code_obs_idx" ON "lab_observations" USING btree ("patient_id","test_code","observed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "lab_reports_patient_created_idx" ON "lab_reports" USING btree ("patient_id","created_at");--> statement-breakpoint
ALTER TABLE "prescription_drafts" ADD CONSTRAINT "prescription_drafts_source_document_id_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;