-- CliniX document storage bucket (Phase 4).
-- Private bucket: objects are reachable only via short-lived signed URLs.
-- Real authorization lives in Fastify (CLAUDE.md), not in storage RLS; the
-- default service_role policy already permits the service key to read/write,
-- and anon/authenticated roles get nothing (private bucket).

insert into storage.buckets (id, name, public)
values ('clinix-documents', 'clinix-documents', false)
on conflict (id) do nothing;
