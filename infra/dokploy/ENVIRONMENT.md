# CliniX production configuration

Source and Android releases remain PRIVATE in `AdvaitR7/ClinixAI`. Do not create a second repository or change visibility.

## DNS and resources

| Record | Target |
|---|---|
| `clinix.thecontractor.me` A | `194.163.133.221` |
| `clinix-api.thecontractor.me` A | `194.163.133.221` |

Both records resolved to this address during setup. Recheck before deploying.

Created through Dokploy MCP:
- Project `CliniX`: `8mR7JQBJ4SX4Kqg0_GkSB`
- Production environment: `5xJDuBR3PRpbVo0PjyMZE`
- Compose `clinix-production`: `7Jxmrks48l5Hvi2Hs9jGG`
- App name: `compose-synthesize-bluetooth-sensor-dia314`
- Web domain routes to `web:3000`; API domain routes to `api:4000`, both configured for Let's Encrypt.

The separate `Routing` project and its 9Router/OmniRoute services must be preserved.

## GitHub → Settings → Secrets and variables → Actions → Variables

| Name | Value | Rebuild needed |
|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `https://clinix-api.thecontractor.me/api/v1` | Web/APK |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing Supabase project URL | Web/APK |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Existing Supabase public key | Web/APK |
| `NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL` | `https://clinix.thecontractor.me` | Web/APK |
| `CLINIX_AUTH_HOST` | `clinix.thecontractor.me` | APK |
| `ANDROID_APP_LINK_SHA256_CERT_FINGERPRINT` | Release certificate fingerprint from keytool | Web/APK |
| `DOKPLOY_URL` | `https://sapienza.thecontractor.me`, without `/api` | No |
| `DOKPLOY_COMPOSE_ID` | `7Jxmrks48l5Hvi2Hs9jGG` | No |

Public configuration is embedded in the APK. It must never contain a service-role key, router key, signing password or deployment token.

## GitHub → Settings → Environments → production → Secrets

Create environment `production`. Add `DOKPLOY_API_KEY`, limited to CliniX where supported. The explicit promotion workflow uses it; PR jobs do not.

## GitHub → Actions → Repository secrets

| Name | Source |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | Base64 of original permanent release keystore |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Release key alias |
| `ANDROID_KEY_PASSWORD` | Key password |

Keep an encrypted copy of the keystore outside GitHub and the VPS. Never replace the key after distributing an APK. The built-in workflow `GITHUB_TOKEN` publishes releases to this same private repository; no cross-repository token is needed.

## Dokploy → CliniX → production → clinix-production → Environment

Enter only production values. Changing these requires redeployment, not rebuilding the APK.

| Name | Source / value | Consumers |
|---|---|---|
| `DATABASE_URL` | Existing Supabase direct/session connection, suitable for pg-boss; never transaction pooling | API, worker, migrate, verify |
| `IDENTITY_ENCRYPTION_KEY` | ORIGINAL 64-hex key; retain for existing encrypted records | API, worker |
| `SUPABASE_URL` | Existing project URL | API, worker |
| `SUPABASE_PUBLISHABLE_KEY` | Existing public key | API |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server credential | API, worker |
| `SUPABASE_JWT_ISSUER` | Actual project issuer, usually `<SUPABASE_URL>/auth/v1` | API |
| `SUPABASE_JWT_VERIFICATION_MODE` | Inspected mode: `asymmetric` or `auth_server` | API |
| `SUPABASE_JWT_ALLOWED_ALGORITHMS` | Actual project signing algorithms, not an assumed default | API |
| `CORS_ORIGINS` | `https://localhost,https://clinix.thecontractor.me` | API |
| `NINEROUTER_BASE_URL` | `https://9router.thecontractor.me/v1` | Worker, verify |
| `NINEROUTER_API_KEY` | Existing router credential | Worker, verify |
| `MODEL_ROUTE_ANALYST_1` | Exact supplied route ID | Worker, verify |
| `MODEL_ROUTE_ANALYST_2` | Exact supplied route ID | Worker, verify |
| `MODEL_ROUTE_JUDGE` | Exact supplied route ID | Worker, verify |
| `MODEL_ROUTE_OCR` | Exact supplied route ID | Worker, verify |
| `GITHUB_RELEASE_READ_TOKEN` | Optional fine-grained GitHub token: Contents READ on this private repo only | API |

`ANDROID_RELEASE_REPOSITORY=AdvaitR7/ClinixAI` is fixed in Compose. The update endpoint uses the server-side read token to fetch private metadata and returns a GitHub release PAGE URL. Downloading the APK requires the user's GitHub login. The token is never returned to the phone. If no token is configured, update lookup reports unavailable; manual private release downloads remain available.

Leave `DEMO_REPLAY` unset. Leave `MODEL_ROUTE_STT` unset until speech is enabled. Pool defaults: API 4 + queue 1; worker 2 + queue 1. Verification temporarily adds a connection; check the actual Supabase allowance.

`CLINIX_IMAGE_TAG` is required for the initial template; promotion replaces it with a literal full SHA in every image reference. Do not use `latest`.

## Private registry access

Dokploy → Registry: configure GHCR with a credential that can READ the private `clinix-web`, `clinix-api`, and `clinix-worker` packages. Keep packages private. Verify the server can pull each SHA before the first deployment. Do not make packages public to bypass missing credentials.

## Supabase Dashboard

Authentication → URL Configuration:
- Site URL: `https://clinix.thecontractor.me`
- Redirect URLs: `https://clinix.thecontractor.me/auth/callback`
- Recovery redirect: `https://clinix.thecontractor.me/auth/callback?next=%2Freset-password`

Verify SMTP and callback delivery. Preserve the existing project, records, bucket, policies and encryption key. Test signed storage requests from both `https://localhost` and the web origin; configure allowed origins where the storage deployment supports that setting. Do not loosen bucket access policies to solve CORS.

## Offsite backups and alerts — required external inputs

No offsite destination was configured during initial inspection. Before production patient use, supply an S3-compatible destination and backup credentials through secure configuration. Back up BOTH database data and actual Storage objects; a VPS-volume backup does not cover Supabase cloud data.

Daily schedule: `0 2 * * *` UTC. Retention: 30 daily copies and 12 monthly copies. Use a PostgreSQL client compatible with the server, an approved direct/session backup connection, checksums, and a document manifest. Separately encrypt and retain the identity key and Android signing key. Alert on backup failure or last success older than 26 hours. Restore into an isolated Supabase project and verify decryption and document contents before launch. Do not enable an empty or untested backup schedule.

Monitor API HTTPS/DB status, web/callback availability, Docker worker heartbeat, queue failures/stalls, router failures and certificate expiry. Use operational identifiers and counts only; exclude patient data, prompts and credentials. Configure an alert destination before patient launch.

## Backup service and schedule

The `backup` operations container has no public ingress. Its PostgreSQL 17 client must match the actual Supabase server major (adjust the backup Dockerfile if the server is newer). Dokploy schedule `CliniX daily offsite database and documents` is created at `02:00 UTC` but DISABLED until configuration and restore validation.

Add these ONLY to Dokploy Environment:

| Name | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Approved direct/session PostgreSQL backup connection |
| `BACKUP_S3_URI` | `s3://<offsite-bucket>/clinix` |
| `BACKUP_AWS_ACCESS_KEY_ID` | Restricted offsite destination key |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Restricted destination secret |
| `BACKUP_AWS_REGION` | Destination region |
| `BACKUP_AWS_ENDPOINT_URL` | Optional S3-compatible HTTPS endpoint |

Set bucket lifecycle rules: expire `clinix/daily/` after 30 days and `clinix/monthly/` after 366 days. Require server-side encryption and restrict access to the backup prefix. The script uploads checksummed database/document snapshots with AES256 server-side encryption, makes a monthly copy on the first day, and updates `last-success.json` only when all uploads succeed. Object names appear only inside the protected backup manifest. Configure an external alert to read that success marker and alert after 26 hours or on a failed Dokploy schedule.

Run the schedule manually once, then download that snapshot into an isolated environment. Verify `database_sha256` and every document checksum in manifest.json. Restore the dump using `pg_restore --no-owner --no-acl` into an EMPTY non-production Supabase project with compatible roles/extensions; recreate the private document bucket and upload the original object paths from the manifest. Never run restore against production. Verify identity decryption with the separately held ORIGINAL identity key and signed document access. Record the drill result before enabling the daily schedule.

Database and object captures are not one atomic snapshot: the manifest records the backup start time. Pause application writes for the first restoration drill and document any later restore-point gap. Do not claim point-in-time document recovery from these daily copies.
