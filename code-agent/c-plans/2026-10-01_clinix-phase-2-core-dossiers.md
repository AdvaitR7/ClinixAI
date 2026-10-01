---
name: clinix-phase-2-core-dossiers
overview: Phase 2 — patient/doctor dossiers, schedule, directory (Screens 3, 4, 15, 16, 17, 22) on Fastify + Next.js.
created: 2026-10-01 IST
session: clinix-master
sequence: 03
source_request: Implement master plan Phase 2 — Core dossiers (Screens 3, 4, 15, 16, 17, 22).
plan_path: code-agent/c-plans/2026-10-01_clinix-phase-2-core-dossiers.md
todos:
  - id: wp1-shared-helpers
    content: WP1 — shared API helpers (http.ts, identity.ts, guards.ts), dedupe route files
    status: pending
  - id: wp2-schemas
    content: WP2 — Phase 2 Zod schemas in packages/schemas
    status: pending
  - id: wp3-migration
    content: WP3 — Drizzle migration: relationships, encounters, appointments, payment_events, doctor_availability + indexes
    status: pending
  - id: wp4-endpoints
    content: WP4 — API endpoints (doctor-patients, relationships, encounters, availability, appointments, dashboards)
    status: pending
  - id: wp5-web-foundation
    content: WP5 — web foundation (useApiData, workspace-shell disabled nav, skeleton, status-badge)
    status: pending
  - id: wp6-screens
    content: WP6 — screens 3, 4, 15, 16, 17, 22 + interim booking flow
    status: pending
  - id: wp7-gate
    content: WP7 — gate script + merge
    status: pending
isProject: true
---

# CliniX AI — Phase 2 — Core dossiers (Screens 3, 4, 15, 16, 17, 22)

## Status

WP1–WP6 complete (2026-10-01): migration 0001 applied; API + web typecheck pass; web build passes; API boots, `/health` green, all 16 routes register (401 without token); `computeSlots` slot math verified. WP7 gate: **authenticated E2E pending** — requires real Clerk doctor+patient session tokens (human step, same as Phase 1). Merge to master only after that gate is green.

## Human

None — all credentials (Supabase, Clerk) already in place from Phases 0–1.

## Agent

### WP1 — Shared API helpers
- `services/api/src/http.ts`: `error(request, reply, status, code, message)` + `requireDb()`.
- `services/api/src/patients/identity.ts`: `isAdult`, `encryptPatientIdentity`, `decryptMinimal`.
- `services/api/src/auth/guards.ts`: `requireDoctor`, `requirePatient`, `authorizePatientAccess` (Phase 6 consent/access-log seam).
- Update `patients/routes.ts`, `doctors/routes.ts`, `auth/context.ts` to import lifted helpers.

### WP2 — Schemas (`packages/schemas/src/index.ts`)
Enums + request/response Zod for Phase 2 (see plan file).

### WP3 — Migration
Append enums + tables to `services/api/src/schema.ts`: `patientDoctorRelationships`, `encounters`, `appointments`, `paymentEvents`, `doctorAvailability` + §41 indexes + `patient_identity(phone_hash)` index. `db:generate` → inspect (CREATE-only) → `db:check` → `db:migrate`.

### WP4 — Endpoints (all `/api/v1`, Bearer, role from Postgres)
| Method | Path | File |
|---|---|---|
| POST | `/doctor/patients` | `src/doctor-patients/routes.ts` |
| GET | `/doctor/patients?q&filter` | same |
| GET | `/doctor/patients/{patient_id}/workspace` | same |
| GET/POST | `/patients/self/doctors`, `/patients/self/doctors/{doctor_id}/relationships` | `src/relationships/routes.ts` |
| GET | `/doctors` | `src/relationships/routes.ts` |
| POST | `/patients/self/encounters` | `src/encounters/routes.ts` |
| GET | `/doctors/{doctor_id}/availability` | `src/availability/routes.ts` |
| PUT | `/doctors/self/availability` | same |
| POST | `/patients/self/appointments` | `src/appointments/routes.ts` |
| GET | `/doctor/appointments?from&to` | same |
| POST | `/doctor/appointments/{id}/confirm` `/complete` `/payment-status` | same |
| POST | `/appointments/{id}/cancel` | same |
| GET | `/doctor/dashboard` `/patients/self/dashboard` | `src/dashboards/routes.ts` |

### WP5 — Web foundation
`useApiData` hook in `lib/api.ts`; `WorkspaceShell` nav `disabled`; `skeleton.tsx` + `status-badge.tsx`.

### WP6 — Screens
Pages 3, 4, 15, 16, 17, 22 + interim `/app/patient/book`.

## Contract extensions & deferrals

- `doctor_availability` table — DB spec has no availability table; this is the source of truth for §14.
- `GET /doctors` — doctor picker (no other doctor-list endpoint in contract).
- `GET /doctor/patients` — Page 16 directory list (not in contract; §17 covers only workspace).
- `GET /doctor/appointments` — Page 15 schedule list (contract has create/confirm/payment/complete only).
- `POST /appointments/{id}/cancel` — cancel path (contract has no cancel).
- `payment_events` pulled forward from Phase 3 (Page 15 payment-status update writes it).
- `/app/patient/book` interim booking flow — superseded by Page 14 in Phase 3.
- Claim invitation (`record_claim_invitations`) deferred to Phase 3 with the claim loop.

## Gate

```text
npm run db:check && npm run db:migrate   → 0001 applied
npm run dev                              → web :3000 + api :4000
curl localhost:4000/health               → {"ok":true,"db":"up"}
npm run typecheck                        → pass
# curl: availability → create unclaimed patient (409 duplicate) → book (409 overlap)
#       → dashboard → confirm → schedule list
# browser: Page 16 → 15 → 17 → 3 with both roles
```

## Risks

- Enum additions on applied DB are CREATE TYPE (additive) — inspect 0001 SQL for ALTERs first.
- Overlap guard is check-then-insert (not SERIALIZABLE) — `ponytail:` comment.
- Name search batch-decrypts at prototype scale.
- Relationship `status` is text per spec — app vocabulary 'ACTIVE' | 'ENDED'.
