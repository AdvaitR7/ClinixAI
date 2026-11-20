# Environment configuration

Configure CliniX AI with your own Supabase project and, for OCR or AI, your own model gateway. Use [local development](local-dev.md) for localhost URLs and [deployment](deployment.md) for hosted services.

Last verified: 2026-11-20 against the API, worker and web configuration code.

## Supabase and server secrets

Get the project URL and API keys from your Supabase dashboard. From **Connect**, choose the [direct connection or IPv4 session pooler](https://supabase.com/docs/guides/database/connecting-to-postgres). Use TLS for hosted database connections. Do not use transaction pooling for this setup.

| Name | Set on | Value |
|---|---|---|
| `DATABASE_URL` | API, worker, migration process | PostgreSQL connection string for your project |
| `SUPABASE_URL` | API, worker | Project URL, without `/auth/v1` |
| `SUPABASE_PUBLISHABLE_KEY` | API | Project publishable key (legacy `SUPABASE_ANON_KEY` also supported) |
| `SUPABASE_SERVICE_ROLE_KEY` | API, worker | Project service-role key; server-side only |
| `IDENTITY_ENCRYPTION_KEY` | API, worker | Same securely generated 32-byte hex key on both services; generate a new key only for a new database, e.g. `openssl rand -hex 32` |
| `SUPABASE_JWT_VERIFICATION_MODE` | API | `asymmetric` for supported asymmetric signing keys using JWKS, or `auth_server` to validate via Supabase Auth |
| `SUPABASE_JWT_ISSUER` | API | Token issuer, normally the project URL followed by `/auth/v1` |
| `SUPABASE_JWT_ALLOWED_ALGORITHMS` | API | Comma-separated list of the project's actual signing algorithms in `asymmetric` mode |
| `CORS_ORIGINS` | API | Comma-separated permitted web origins (scheme and host, including any port). Include `https://localhost` only for Android WebView clients |

Preserve the original identity key for deployments using existing records and keep an encrypted backup of it. Never expose database URLs, service-role keys, identity keys or gateway credentials to the frontend.

## Web build and Auth

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | API origin with `/api/v1`, e.g. `https://api.example.com/api/v1` |
| `NEXT_PUBLIC_SUPABASE_URL` | Same project URL as the API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same project publishable (or legacy anon) key |
| `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` | Web origin, e.g. `https://app.example.com` |

These variables are embedded at build time. Rebuild after changing them. In Supabase **Authentication → URL Configuration**, set the site URL to the web origin and allow its `/auth/callback` and `/auth/callback?next=%2Freset-password` URLs. Test confirmation and recovery email delivery. Keep the documents bucket private.

## Worker only

Set `NINEROUTER_BASE_URL` to your OpenAI-compatible 9Router base URL and `NINEROUTER_API_KEY` to its API key. Configure `MODEL_ROUTE_ANALYST_1`, `MODEL_ROUTE_ANALYST_2`, `MODEL_ROUTE_JUDGE` and `MODEL_ROUTE_OCR` with routes available on your gateway. Leave `DEMO_REPLAY` and `MODEL_ROUTE_STT` unset for ordinary deployment. Check total database connection use across processes and replicas before adjusting `DB_POOL_MAX` or `QUEUE_POOL_MAX`.

## Backups

Back up both PostgreSQL and the Storage objects. If using the repository's [backup script](../../scripts/backup/supabase.mjs), configure `BACKUP_DATABASE_URL`, `BACKUP_S3_URI`, `BACKUP_AWS_ACCESS_KEY_ID`, `BACKUP_AWS_SECRET_ACCESS_KEY`, `BACKUP_AWS_REGION` and, for compatible providers, `BACKUP_AWS_ENDPOINT_URL`. Use a restricted destination, a compatible `pg_dump`, and an isolated project to test restoring the database, identity decryption and document access before scheduling backups. Database and Storage captures are not atomic; don't treat them as point-in-time document recovery.
