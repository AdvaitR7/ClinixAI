# Deploying CliniX to Dokploy

Web, api and worker run as one Docker Compose application on Dokploy. Postgres, Auth and Storage stay on Supabase.

```
Browser / Android app ──► app.<domain>  (web, Next.js :3000)
                              │ Bearer token
                              ▼
                          api.<domain>  (api, Fastify :4000) ──► Supabase Postgres / Auth / Storage
                          worker (pg-boss jobs) ───────────────┘
        Traefik (managed by Dokploy) terminates HTTPS
```

## 1. Prerequisites (you do these)

1. A Dokploy server with two DNS records pointing at it: `app.<domain>` and `api.<domain>`.
2. A Supabase project with the `clinix-documents` bucket (`infra/supabase/bucket.sql`).
3. A 64-hex-character identity key. Use the **original** key if synthetic data already exists, because a different key cannot decrypt existing rows. Otherwise generate one with `openssl rand -hex 32` and reseed.

## 2. Create the application

1. Dokploy → Project → **Create Service → Compose**. Source: this Git repo, branch `master`, compose path `infra/dokploy/docker-compose.yml`.
2. **Environment** tab: set the variables listed below. Names only appear in this repo; values live only in Dokploy.
3. **Domains** tab: add `app.<domain>` → service `web`, port `3000`, HTTPS on (Let's Encrypt); add `api.<domain>` → service `api`, port `4000`, HTTPS on.
4. Deploy. Order is enforced by the compose file: `migrate` runs and exits 0, then `api` and `worker` start.

### Environment variables

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | migrate, api, worker | Supabase **session** pooler (port 5432), or the direct connection if the VPS has IPv6. Do not use the transaction pooler: pg-boss needs LISTEN/NOTIFY and postgres.js pipelining misbehaves there. |
| `IDENTITY_ENCRYPTION_KEY` | api, worker | 64 hex chars. The api refuses to start without it. |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | api (worker: URL + service role) | Service role stays server-side only. |
| `SUPABASE_ANON_KEY` | api | Optional. |
| `SUPABASE_JWT_VERIFICATION_MODE`, `SUPABASE_JWT_ISSUER`, `SUPABASE_JWT_ALLOWED_ALGORITHMS` | api | Must match the project that issues browser tokens. |
| `CORS_ORIGINS` | api | `https://app.<domain>` (comma-separated for more). The Android app loads this same origin. |
| `NEXT_PUBLIC_API_BASE_URL` | web (build) | `https://api.<domain>/api/v1`. Must be HTTPS in production. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | web (build) | Public by design. |
| `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` | web (build) | `https://app.<domain>` |
| `NINEROUTER_BASE_URL`, `NINEROUTER_API_KEY`, `MODEL_ROUTE_ANALYST_1/2`, `MODEL_ROUTE_JUDGE`, `MODEL_ROUTE_OCR`, `MODEL_ROUTE_STT` | worker | AI/OCR. Leave empty to disable; the worker's AI jobs then fail. |
| `DEMO_REPLAY` | worker | Optional (`replay` for model-free demos). |
| `DB_POOL_MAX`, `QUEUE_POOL_MAX`, `WORKER_DB_POOL_MAX`, `WORKER_QUEUE_POOL_MAX` | api / worker | Defaults 4, 1, 2, 1 = 8 connections. Supabase session mode allows 15 across everything, including your own psql and seed runs. |
| `CLINIX_IMAGE_PREFIX`, `CLINIX_IMAGE_TAG` | compose | Optional image names (see "Building elsewhere"). |

Because `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, changing them requires a rebuild.

## 3. Supabase dashboard (manual)

- Authentication → URL Configuration: **Site URL** `https://app.<domain>`; **Redirect URLs** include `https://app.<domain>/auth/callback`.
- Authentication → SMTP: confirm email delivery works.
- Storage → CORS: allow `https://app.<domain>` for signed `PUT` uploads.

## 4. Health checks and rollback

Every service has a Docker `HEALTHCHECK` (web `/sign-in`, api `/health` with `db: up`, worker heartbeat file younger than 60 s). In the application's **Advanced → Swarm Settings** you can add Dokploy's recommended update config so an unhealthy release rolls back:

```json
{ "Parallelism": 1, "Delay": 10000000000, "FailureAction": "rollback", "Order": "start-first" }
```

The api and worker handle SIGTERM: they stop accepting work, let in-flight jobs finish, then close their pools (`stop_grace_period: 20s`).

## 5. Building elsewhere (optional)

`.github/workflows/docker-publish.yml` runs typecheck and tests, builds the three images, pushes them to GHCR (`ghcr.io/<owner>/clinix-{web,api,worker}`) and calls a Dokploy webhook. Add repository **variables** `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL`, and the repository **secret** `DOKPLOY_DEPLOY_WEBHOOK` (from the application's Deployments tab). Dokploy's own guidance is to avoid building on the VPS because builds can exhaust its RAM. Note that the compose file as written builds from source; to deploy the pre-built images instead, create one Dokploy **Application** per image with source type Docker. This path has not been exercised.

## 6. Backups

Supabase is a single point of failure. Take periodic dumps over a **direct** connection (not a pooler):

```bash
pg_dump "$DIRECT_DATABASE_URL" --format=custom --file=clinix-$(date +%F).dump
```

Store dumps outside the VPS. Dumps contain encrypted patient identity data; the identity key must be backed up separately.

## 7. Known limits

- The Docker images have **not been built** on the machine where this was written (Docker was not installed). First build on Dokploy or CI is the first real test.
- The worker's AI features need a valid 9Router key.
