# CliniX AI — Project Rules

These rules are authoritative for any AI coding agent working in this repo. They mirror and extend `.sensitive_docs/README.md`.

## Architectural invariant (do not violate)

- The backend API is **Fastify** at `/api/v1` (`services/api`). **Never** implement API endpoints as Next.js route handlers in `apps/web`. If you find yourself about to write a `route.ts`/`route.js` under `apps/web/app` that does backend work, stop — it belongs in `services/api`.
- Two services only: `apps/web` (Next.js, frontend) + `services/api` (Fastify, backend). A `services/worker` (pg-boss) is added in later phases, not Phase 0.
- Specs in `docs/` are the source of truth. Conflict between spec and code → spec wins; conflict between specs → ask the user.

## Credential rules

1. **Never read or print the values** in `.sensitive_docs/credentials.md` into chat, plan files, commits, logs, or screenshots.
2. **Never commit** `.env`, `.env.local`, or `.sensitive_docs/credentials.md`. The root `.gitignore` blocks them; do not edit those patterns away.
3. If a credential is missing at a phase gate, **stop and ask the user** — do not invent placeholder values that make a gate "pass".
4. Keys live in `.env` files; the example files (`.env.example`) carry only the variable **names**, never values.

## Safety rails (enforce in generated code)

- OCR, voice, and AI output is **always draft-first** — a doctor must explicitly finalize; no AI/OCR/voice path may auto-finalize a prescription or write to clinical-fact tables as authoritative.
- `access_events` is **append-only** — app roles may INSERT, never UPDATE/DELETE.
- AI payloads carry **no direct identifiers** (no name/phone/email/exact address); Evidence Bundles set `contains_direct_identifiers = false`.
- Seed/demo data is **synthetic only**. No real PII or real clinical data, ever.
- Finalized prescriptions are **immutable** — changes create a new version, never edit in place.

## Package manager

- **npm workspaces** (not pnpm). Node 24 + npm 11. No corepack.
