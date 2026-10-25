ALTER TABLE "profiles" RENAME COLUMN "clerk_user_id" TO "legacy_auth_subject";--> statement-breakpoint
ALTER TABLE "profiles" DROP CONSTRAINT "profiles_clerk_user_id_unique";--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "supabase_user_id" uuid;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_legacy_auth_subject_unique" UNIQUE("legacy_auth_subject");--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_supabase_user_id_unique" UNIQUE("supabase_user_id");