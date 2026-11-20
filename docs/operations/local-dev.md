# Local development

From a fresh clone to a running app with synthetic data.

Last verified: 2026-11-20 against the workspace scripts, migrations and environment templates.

## Requirements

- Node 24 and npm 11 (npm workspaces; no pnpm or corepack)
- Your own Supabase Cloud project with Postgres, Auth and Storage. Use a dedicated project with synthetic data only.
- A 9Router endpoint and API key only if you want to run OCR or AI analysis.
- Chromium for browser tests (`npx playwright install chromium`); JDK 21 and Android SDK for APK builds.

## Setup

1. In your Supabase project, enable the `vector` extension under Database → Extensions. Run [bucket.sql](../../infra/supabase/bucket.sql) in the SQL Editor to create the private documents bucket. In Auth URL Configuration set the site URL to `http://localhost:3000` and allow `http://localhost:3000/auth/callback` and `http://localhost:3000/auth/callback?next=%2Freset-password`.
2. Install dependencies and copy the templates. Skip the worker template if you are not testing OCR or AI.

   ```bash
   npm ci
   cp services/api/.env.example services/api/.env
   cp apps/web/.env.example apps/web/.env.local
   cp services/worker/.env.example services/worker/.env
   ```

3. Fill the files using [the configuration guide](environment.md). For the default local ports, use `http://localhost:4000/api/v1` as `NEXT_PUBLIC_API_BASE_URL`, and `http://localhost:3000` as both `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` and `CORS_ORIGINS`. Use `NODE_ENV=development` for the API and worker, and set `SEED_DEMO_PASSWORD` in the API env if you plan to seed.
4. Apply migrations before starting the API. Run the API, web and (optionally) worker in separate terminals.

   ```bash
   npm run db:migrate
   npm run dev:api
   npm run dev:web
   # Optional, after configuring the worker:
   npm run dev:worker
   ```

5. Check `curl -fsS http://localhost:4000/health` for `ok: true` and `db: "up"`, then open `http://localhost:3000`. Without the worker, queued OCR and AI jobs will not complete.

### Or one launcher on fixed ports

```bash
./run.sh      # web http://localhost:12455, API :12456, worker
```

`scripts/run.mjs` reuses your env files and sets matching CORS and auth URLs. It waits for DB and service health and retries a crashed service up to three times. If a port is busy it errors out and never kills other servers. Stop older `npm run dev` instances first, so you don't double the DB pool. API and worker changes need a restart; the web app hot-reloads. For password-reset callbacks, add `http://localhost:12455/auth/callback` to the Supabase Auth redirect allowlist.

## Environment variables (names only)

| File | Variables |
|---|---|
| `services/api/.env` | `NODE_ENV`, `PORT`, `DATABASE_URL`, `IDENTITY_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_VERIFICATION_MODE`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_ALLOWED_ALGORITHMS`, `SUPABASE_GATE_DOCTOR_EMAIL`, `SUPABASE_GATE_PATIENT_EMAIL`, `SUPABASE_GATE_PASSWORD`, `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `MODEL_ROUTE_*`, `CORS_ORIGINS`, `DB_POOL_MAX`, `QUEUE_POOL_MAX`, `SEED_DEMO_PASSWORD`, `SEED_API_BASE_URL` |
| `services/worker/.env` | `NODE_ENV`, `DATABASE_URL`, `IDENTITY_ENCRYPTION_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `MODEL_ROUTE_ANALYST_1`, `MODEL_ROUTE_ANALYST_2`, `MODEL_ROUTE_JUDGE`, `MODEL_ROUTE_OCR`, `DEMO_REPLAY`, `DB_POOL_MAX`, `QUEUE_POOL_MAX`; optional `MODEL_REASONING_EFFORT` |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` |

Notes:

- Use the Supabase direct connection or IPv4 session pooler, not the transaction pooler. Check your project's connection limit before running multiple stacks.
- `CORS_ORIGINS` is a comma-separated allowlist. If it's unset, development allows any origin. With `NODE_ENV=production` the API refuses to start without it.
- `IDENTITY_ENCRYPTION_KEY` encrypts patient identity fields (AES-256-GCM). Losing it makes existing records unreadable.
- `.env.example` files carry names only. Never commit populated environment files.

## Synthetic demo data

```bash
npm run dev:api        # the seed drives state through the real API
npm run seed           # idempotent and additive; a second run creates nothing
```

The seed needs `SEED_DEMO_PASSWORD`. It creates accounts on the reserved `demo.clinix.test` domain and prints emails and roles only.

| Persona | Account | Content |
|---|---|---|
| Doctor | `kavita.rao@demo.clinix.test` | Verified (seed only), published profile and availability, owns the demo practice |
| Receptionist, assistant | `priya.nair@…`, `imran.qureshi@…` | Active practice memberships |
| A, respiratory | `ananya.krishnan@…` | Past cough visit, amoxicillin with a rash, lab PDF, prescription photo, upcoming visit |
| B, metabolic | `rohan.mehta@…` | Five HbA1c results over five months, current metformin |
| C, red flag | `sunita.verma@…` | Minimal record; scripted chest-pain check-in |

Nothing is ever deleted. The access ledger is append-only, so there's no reset. The walkthrough is in [demo-rehearsal.md](demo-rehearsal.md).

## AI replay

`DEMO_REPLAY` in `services/worker/.env` is opt-in and off by default.

- `record`: saves a successful live model call to `services/worker/ai/replays/<role>/<key>.json`.
- `replay`: returns a matching file without calling the model (it's still schema-checked). If there's no match, it falls back to a live call.

Replayed runs are stored as `replay:<route>` in `ai_model_runs`. The safety post-check still runs, and results stay draft-first. Run `node services/worker/check-replays.mjs` before committing recordings.
