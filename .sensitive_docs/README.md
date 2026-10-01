# .sensitive_docs — What Information Goes Where

This folder is the registry for every external-service credential CliniX AI uses.
**Never commit `credentials.md`.** Only this `README.md` is tracked in git.

## Files

| File | Tracked in git? | Contents |
|---|---|---|
| `README.md` | ✅ yes (this file) | Instructions only — zero secrets |
| `credentials.md` | ❌ no (gitignored) | Actual key values — you fill this in by hand |

## Credential registry — what goes where

When you obtain each credential, paste it in **two places**: `credentials.md` (reference) and the `.env` file listed below (so the app actually reads it).

| # | Credential | From | Goes into | Needed by phase |
|---|---|---|---|---|
| 1 | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk dashboard → API keys | `apps/web/.env.local` | 1 |
| 2 | `CLERK_SECRET_KEY` | Clerk dashboard → API keys | `services/api/.env` | 1 |
| 3 | `CLERK_WEBHOOK_SIGNING_SECRET` | Clerk dashboard → Webhooks (only when webhooks enabled) | `services/api/.env` | 1 (optional — see lazy-sync note in master plan) |
| 4 | `DATABASE_URL` | Supabase dashboard → Project settings → Database → Connection string → **Session pooler** (port 5432) | `services/api/.env`, `services/worker/.env` | 0 |
| 4a | `IDENTITY_ENCRYPTION_KEY` | Generate locally: `openssl rand -hex 32` (64 hex chars, 32 bytes) — used for app-layer AES-256-GCM encryption + HMAC of `patient_identity` fields | `services/api/.env` | 1 |
| 5 | `SUPABASE_URL` | Supabase dashboard → Settings → API (`https://<ref>.supabase.co`) | `services/api/.env` | 4 |
| 6 | `SUPABASE_ANON_KEY` | Supabase dashboard → Settings → API | `services/api/.env` | 4 |
| 7 | `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Settings → API | `services/api/.env` | 4 |
| 8 | `NINEROUTER_BASE_URL` | 9Router dashboard | `services/api/.env`, `services/worker/.env` | 5 |
| 9 | `NINEROUTER_API_KEY` | 9Router dashboard | `services/api/.env`, `services/worker/.env` | 5 |
| 10 | Pinned 9Router model route IDs for Analyst 1 / Analyst 2 / Judge / OCR (Gemini 3.8 Flash High) | 9Router dashboard routes | `services/api/.env` (see master plan env table) | 5 |
| 11 | Figma file URL / node links | Figma app → Share | Give to the AI agent in chat — the Figma MCP reads it live; no file needed | 1 (for screens) |

## Rules for the AI coding agent (also mirrored in root `CLAUDE.md`)

1. **Never read or print the values** in `credentials.md` into chat, plan files, commits, logs, or screenshots.
2. **Never commit** `.env`, `.env.local`, or `credentials.md`. The root `.gitignore` blocks them; do not edit those patterns away.
3. If a credential is missing at a phase gate, **stop and ask the user** — do not invent placeholder values that make a gate "pass".
4. Keys live in `.env` files; the example files (`.env.example`) carry only the variable **names**, never values.

## How you (the human) provide each thing

| You provide | How |
|---|---|
| Clerk keys | Create Clerk app → copy keys → paste into `apps/web/.env.local` + `services/api/.env` + `credentials.md` |
| Supabase connection | Create project (Mumbai region) → copy session-pooler URL → paste into `services/api/.env` etc. |
| 9Router key/route IDs | Copy from 9Router dashboard → paste into `.env`s |
| Figma link | Paste the figma.com/design/... URL directly into the chat session |
