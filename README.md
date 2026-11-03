# CliniX AI

Privacy-first personal health record and clinical workflow prototype: a patient app, a doctor workspace and a clinic staff workspace, with draft-first AI and OCR, a consent-scoped access ledger, and an installable phone app (PWA).

Two services only: `apps/web` (Next.js, frontend) and `services/api` (Fastify at `/api/v1`, backend), plus `services/worker` (pg-boss jobs for OCR and AI analysis). Rules for contributors and coding agents are in [CLAUDE.md](CLAUDE.md).

## Requirements

- Node 24 and npm 11 (npm workspaces; no pnpm, no corepack)
- A Supabase Cloud project (Postgres with `pgvector`, Auth, Storage). Supabase is never run locally.
- A 9Router endpoint for the worker's AI and OCR calls (synthetic data only)
- Chromium for browser tests: `npx playwright install chromium`
- Docker, only for the local production run

## Fresh clone to running app

```bash
git clone <repo-url> clinix && cd clinix
npm ci

# Copy the example files, then fill the values from .sensitive_docs/credentials.md (never committed).
cp services/api/.env.example services/api/.env
cp services/worker/.env.example services/worker/.env
cp apps/web/.env.example apps/web/.env.local

npm run db:migrate     # applies the Drizzle migrations to Supabase
npm run dev            # web :3000, api :4000, worker
curl localhost:4000/health   # {"ok":true,"db":"up"}
```

The example files and the root `.env.example` carry variable **names only**. Never commit `.env`, `.env.local` or `.sensitive_docs/credentials.md`.

### Start everything on port 12455

```bash
./run.sh
```

Open http://localhost:12455. The launcher uses the existing environment files, sets matching local auth/CORS URLs, and starts the API on 12456, the worker, then the web app. It waits for database and service readiness, prints service output, and retries an exited service up to three times. Ctrl+C stops all processes it started. Occupied ports cause an explicit error; other servers are never killed. Stop any older `npm run dev` instances before using this launcher to avoid duplicate database pools.

This is a local development launcher; keep its terminal open. API and worker source changes require restarting `./run.sh`; the web app retains Next.js hot reload. Supabase email/password-reset callbacks require `http://localhost:12455/auth/callback` in the project's Auth redirect allowlist.

### Environment variables

| Where | Names |
| --- | --- |
| `services/api/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `IDENTITY_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_VERIFICATION_MODE`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_ALLOWED_ALGORITHMS`, `SUPABASE_GATE_DOCTOR_EMAIL`, `SUPABASE_GATE_PATIENT_EMAIL`, `SUPABASE_GATE_PASSWORD`, `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `MODEL_ROUTE_*`, `CORS_ORIGINS`, `SEED_DEMO_PASSWORD`, `SEED_API_BASE_URL` |
| `services/worker/.env` | `NODE_ENV`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `MODEL_ROUTE_ANALYST_1`, `MODEL_ROUTE_ANALYST_2`, `MODEL_ROUTE_JUDGE`, `MODEL_ROUTE_OCR`, `DEMO_REPLAY` |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` |

`CORS_ORIGINS` is a comma-separated allowlist of web origins. Unset, development keeps the open default; with `NODE_ENV=production` the API refuses to start without it.

## Synthetic demo data

```bash
npm run dev:api          # the seed drives current state through the real API
npm run seed             # idempotent and additive; run it twice, the second run creates nothing
```

Set `SEED_DEMO_PASSWORD` in `services/api/.env` first. The seed creates synthetic accounts on the reserved `demo.clinix.test` domain and prints emails and roles only, never passwords or tokens.

| Persona | Account | Content |
| --- | --- | --- |
| Doctor | `kavita.rao@demo.clinix.test` | Verified synthetic registration, published profile and availability, owns the demo practice |
| Receptionist, assistant | `priya.nair@…`, `imran.qureshi@…` | Active practice memberships |
| A, respiratory | `ananya.krishnan@…` | Past cough visit, amoxicillin course with a rash, lab PDF, prescription photo, upcoming visit |
| B, metabolic | `rohan.mehta@…` | Five HbA1c results over five months, current metformin |
| C, red flag | `sunita.verma@…` | Minimal record; the chest-pain check-in is scripted |

The seed never deletes anything. The access ledger is append-only, so there is no reset.

`node services/api/demo-checkin.mjs a|b|c` runs the scripted check-in for a persona (needs the API and worker).

### Demo replay

`DEMO_REPLAY` in `services/worker/.env` is opt-in and off by default.

- `record`: a live model success is saved to `services/worker/ai/replays/<role>/<key>.json`.
- `replay`: a matching file is returned (still schema-validated) with no model call. A missing key falls back to the live call.

Replayed runs are stored as `replay:<route>` in `ai_model_runs`, the deterministic safety post-check still runs, and results stay draft-first. Before committing recordings run `node services/worker/check-replays.mjs`.

## Checks

```bash
npm run typecheck && npm run lint && npm run test
npm run build                         # emits apps/web/public/sw.js
npm run test:browser                  # Playwright against the dev server, mocked services
npx playwright test -c apps/web/playwright.pwa.config.ts   # production PWA checks on :3200

node services/api/gate-phase8.mjs     # live gate (API on :4000, seeded)
```

Earlier live gates (`gate-phase3.mjs` … `gate-phase7.mjs`) need the API on `:4000` and synthetic gate accounts from `services/api/.env`.

## Installable app (PWA)

The service worker is built by `serwist build` after `next build` (configurator mode, no Next route handler). It caches the app shell only: static assets and an offline page. API, Supabase and auth requests are never cached, so no health data is stored on the device. Development runs without the service worker.

## Local production run and Dokploy

```bash
docker compose --env-file apps/web/.env.local -f infra/dokploy/docker-compose.yml up --build
curl localhost:4000/health
```

The web image takes the `NEXT_PUBLIC_*` values as build args (they are inlined at build time). In production the web app requires HTTPS for the API, Supabase and the auth redirect base URL, so sign-in works only behind TLS; plain `localhost` over HTTP can check images, health, the manifest and the service worker.

Steps only a person can do:

1. Deploy the stack on Dokploy over HTTPS and set `CORS_ORIGINS` to the deployed web origin.
2. In Supabase Auth, add the deployed HTTPS origin to the redirect allowlist and set the Site URL.
3. Check Storage CORS allows signed `PUT` uploads from the deployed origin.
4. Use production keys only with synthetic data.

## Release verification status

Phase 8 code is on `phase-8`; the live Phase 7/8 gates passed 62/42 checks.
The browser suite passed 117 tests and production PWA checks passed 16 tests
(Chromium phone emulation, including the iPhone profile).

Docker is unavailable on the verification host, so image builds and Compose startup
remain unverified. HTTPS deployment, real-phone installation and A+B+C rehearsal
and recording remain release prerequisites. A clean source snapshot passed
`npm ci` and started all three dev services; a committed fresh clone is still pending.
The install reported 31 dependency vulnerabilities requiring assessment before release.

The detailed local verification record and rehearsal script are in
`docs/architecture/17-pwa-release-implementation.md`; `docs/` is currently gitignored.
