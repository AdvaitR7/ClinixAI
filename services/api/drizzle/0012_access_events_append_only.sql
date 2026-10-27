-- Custom SQL migration file, put your code below! --
-- access_events is an append-only ledger (DB spec §26.1). Revoke mutation
-- privileges from every non-owner role, and add a trigger so that even the
-- connecting application role cannot UPDATE or DELETE rows.
REVOKE UPDATE, DELETE, TRUNCATE ON "public"."access_events" FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."access_events_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'access_events is append-only' USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS "access_events_no_mutation" ON "public"."access_events";--> statement-breakpoint
CREATE TRIGGER "access_events_no_mutation"
  BEFORE UPDATE OR DELETE ON "public"."access_events"
  FOR EACH ROW EXECUTE FUNCTION "public"."access_events_append_only"();
