-- Custom SQL migration file, put your code below! --
-- Clinical data is served only by Fastify. RLS remains enabled; remove the
-- browser roles' redundant grants without changing postgres or service_role.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA "public" FROM PUBLIC, "anon", "authenticated";--> statement-breakpoint
-- New application tables created by the migration role must stay private too.
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC, "anon", "authenticated";
