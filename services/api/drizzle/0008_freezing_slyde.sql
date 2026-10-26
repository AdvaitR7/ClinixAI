ALTER TABLE "ai_sessions" ADD COLUMN "patient_outcome" jsonb;--> statement-breakpoint
ALTER TABLE "interaction_sessions" ADD COLUMN "safety_alert" jsonb;