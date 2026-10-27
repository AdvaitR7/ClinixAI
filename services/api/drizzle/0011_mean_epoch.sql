CREATE TYPE "public"."consent_status" AS ENUM('ACTIVE', 'REVOKED', 'EXPIRED');--> statement-breakpoint
CREATE TABLE "consent_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"consent_id" uuid NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"resource_filter" jsonb,
	"permission" text DEFAULT 'READ' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"grantee_type" "actor_type" NOT NULL,
	"grantee_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"status" "consent_status" DEFAULT 'ACTIVE' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_removal_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"target_actor_type" "actor_type" NOT NULL,
	"target_actor_id" uuid,
	"resource_type" text NOT NULL,
	"resource_id" uuid,
	"reason" text,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"routed_by_profile_id" uuid,
	"routed_at" timestamp with time zone,
	"routing_note" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text,
	"resolved_by_profile_id" uuid,
	"decisions" jsonb
);
--> statement-breakpoint
ALTER TABLE "consent_scopes" ADD CONSTRAINT "consent_scopes_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_removal_requests" ADD CONSTRAINT "record_removal_requests_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_removal_requests" ADD CONSTRAINT "record_removal_requests_routed_by_profile_id_profiles_id_fk" FOREIGN KEY ("routed_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_removal_requests" ADD CONSTRAINT "record_removal_requests_resolved_by_profile_id_profiles_id_fk" FOREIGN KEY ("resolved_by_profile_id") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_scopes_consent_idx" ON "consent_scopes" USING btree ("consent_id");--> statement-breakpoint
CREATE INDEX "consents_patient_status_idx" ON "consents" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "consents_grantee_status_idx" ON "consents" USING btree ("grantee_type","grantee_id","status");--> statement-breakpoint
CREATE INDEX "rrr_patient_idx" ON "record_removal_requests" USING btree ("patient_id","status");--> statement-breakpoint
CREATE INDEX "rrr_target_idx" ON "record_removal_requests" USING btree ("target_actor_type","target_actor_id","status");--> statement-breakpoint
ALTER TABLE "access_events" ADD CONSTRAINT "access_events_consent_id_consents_id_fk" FOREIGN KEY ("consent_id") REFERENCES "public"."consents"("id") ON DELETE no action ON UPDATE no action;