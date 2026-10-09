CREATE TYPE "public"."ai_role" AS ENUM('ANALYST_1', 'ANALYST_2', 'JUDGE', 'OUTPUT_COMPOSER');--> statement-breakpoint
CREATE TYPE "public"."ai_run_status" AS ENUM('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'BLOCKED');--> statement-breakpoint
CREATE TABLE "ai_evidence_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_session_id" uuid NOT NULL,
	"bundle_version" integer DEFAULT 1 NOT NULL,
	"payload" jsonb NOT NULL,
	"payload_hash" text NOT NULL,
	"contains_direct_identifiers" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_historical_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_session_id" uuid NOT NULL,
	"current_encounter_id" uuid NOT NULL,
	"historical_encounter_id" uuid NOT NULL,
	"similarity_label" text NOT NULL,
	"similarity_score" numeric,
	"supporting_features" jsonb,
	"differences" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_judgments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_session_id" uuid NOT NULL,
	"agreements" jsonb NOT NULL,
	"material_disagreements" jsonb NOT NULL,
	"unsupported_claims" jsonb NOT NULL,
	"questions_to_ask_next" jsonb NOT NULL,
	"safe_consensus" jsonb NOT NULL,
	"requires_doctor_review" boolean DEFAULT false NOT NULL,
	"requires_urgent_escalation" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_model_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ai_session_id" uuid NOT NULL,
	"role" "ai_role" NOT NULL,
	"provider_route" text NOT NULL,
	"model_name" text NOT NULL,
	"input_hash" text NOT NULL,
	"output_payload" jsonb,
	"output_hash" text,
	"status" "ai_run_status" DEFAULT 'QUEUED' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"encounter_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" "ai_run_status" DEFAULT 'QUEUED' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_session_id" uuid NOT NULL,
	"sequence_number" integer NOT NULL,
	"block_type" text NOT NULL,
	"title" text NOT NULL,
	"help_text" text,
	"options" jsonb,
	"allow_free_text" boolean DEFAULT true NOT NULL,
	"generated_by_ai_session_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"interaction_block_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"selected_option_ids" jsonb,
	"free_text" text,
	"numeric_value" numeric,
	"date_value" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"status" text DEFAULT 'IN_PROGRESS' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "safety_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"encounter_id" uuid NOT NULL,
	"ai_session_id" uuid,
	"stage" text NOT NULL,
	"triggered_rule_ids" jsonb NOT NULL,
	"severity" text NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "semantic_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding" vector(1536),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_evidence_bundles" ADD CONSTRAINT "ai_evidence_bundles_ai_session_id_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_historical_matches" ADD CONSTRAINT "ai_historical_matches_ai_session_id_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_historical_matches" ADD CONSTRAINT "ai_historical_matches_current_encounter_id_encounters_id_fk" FOREIGN KEY ("current_encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_historical_matches" ADD CONSTRAINT "ai_historical_matches_historical_encounter_id_encounters_id_fk" FOREIGN KEY ("historical_encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_judgments" ADD CONSTRAINT "ai_judgments_ai_session_id_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_model_runs" ADD CONSTRAINT "ai_model_runs_ai_session_id_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_sessions" ADD CONSTRAINT "ai_sessions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_blocks" ADD CONSTRAINT "interaction_blocks_interaction_session_id_interaction_sessions_id_fk" FOREIGN KEY ("interaction_session_id") REFERENCES "public"."interaction_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_responses" ADD CONSTRAINT "interaction_responses_interaction_block_id_interaction_blocks_id_fk" FOREIGN KEY ("interaction_block_id") REFERENCES "public"."interaction_blocks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_responses" ADD CONSTRAINT "interaction_responses_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_sessions" ADD CONSTRAINT "interaction_sessions_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_evaluations" ADD CONSTRAINT "safety_evaluations_encounter_id_encounters_id_fk" FOREIGN KEY ("encounter_id") REFERENCES "public"."encounters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_evaluations" ADD CONSTRAINT "safety_evaluations_ai_session_id_ai_sessions_id_fk" FOREIGN KEY ("ai_session_id") REFERENCES "public"."ai_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semantic_chunks" ADD CONSTRAINT "semantic_chunks_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_judgments_session_idx" ON "ai_judgments" USING btree ("ai_session_id");--> statement-breakpoint
CREATE INDEX "ai_model_runs_session_role_idx" ON "ai_model_runs" USING btree ("ai_session_id","role");--> statement-breakpoint
CREATE INDEX "ai_sessions_patient_enc_idx" ON "ai_sessions" USING btree ("patient_id","encounter_id");--> statement-breakpoint
CREATE INDEX "interaction_responses_block_idx" ON "interaction_responses" USING btree ("interaction_block_id");--> statement-breakpoint
CREATE INDEX "safety_evaluations_enc_idx" ON "safety_evaluations" USING btree ("encounter_id");--> statement-breakpoint
CREATE INDEX "semantic_chunks_patient_source_idx" ON "semantic_chunks" USING btree ("patient_id","source_type");