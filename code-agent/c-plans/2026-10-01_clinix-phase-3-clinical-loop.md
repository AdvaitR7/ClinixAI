---
name: clinix-phase-3-clinical-loop
overview: Phase 3 — encounters, consultation notes, direct digital prescriptions (Screens 10, 11, 14, 18, 19, 20), Test Milestone A.
created: 2026-10-07
session: clinix-master
sequence: 04
source_request: Implement master-plan Phase 3 (clinical loop).
plan_path: code-agent/c-plans/2026-10-01_clinix-phase-3-clinical-loop.md
todos:
  - id: clinical-prescribing
    content: Phase 3 — encounters, consultation, direct digital prescriptions (Screens 10,11,14,18,19,20)
    status: completed
isProject: true
---

# Phase 3 — Clinical loop (Screens 10, 11, 14, 18, 19, 20)

## Status

✅ Complete — Test Milestone A gate green (`services/api/gate-phase3.mjs`, 36/36 PASS). Migration `0002` applied to Supabase. `npm run typecheck` + web `build` green. Full E2E run with real Clerk sessions: doctor → unclaimed patient → walk-in booking → encounter (find-or-create idempotent) → note autosave → direct draft (OCR source rejected at the boundary) → finalize (Idempotency-Key required, immutable Version 1) → patient claims via one-time invite code (idempotent; INVITE_USED / ACCOUNT_ALREADY_LINKED negative paths) → patient reads prescription + medication history (all `UNKNOWN_STATUS`, never `CURRENT`) → amend → Version 2 with v1 intact → PDF render (`%PDF-`) → complete finalizes note (`NOTE_FINALIZED` + amendment row) → `access_events` shows DOCTOR:CREATE / PATIENT:VIEW / DOCTOR:VIEW.

## Human

None. No new credentials or env vars. `@react-pdf/renderer` added to `services/api`.

## Agent

### WP1 — Schemas (`packages/schemas/src/index.ts`)
Phase 3 enums (`prescriptionDraftSource/Status`, `prescriptionStatus`), request schemas (`createPrescriptionDraftSchema` with `source` literal `DIRECT_ENTRY`, `patchPrescriptionDraftSchema`, `amendPrescriptionSchema`, `noteSectionsSchema`/`noteAmendSchema`, `doctorCreateEncounterSchema`, `doctorBookAppointmentSchema`, `patientClaimSchema`), view schemas (draft/draft-item/version/prescription/medication/consultationContext/claimInvite + `patientAppointmentViewSchema`).

### WP2 — Migration `0002` (`services/api/src/schema.ts`)
Tables `prescription_drafts` (§18.1), `prescription_draft_items` (§18.2), `prescriptions` (§19.1, circular `current_version_id` FK via `AnyPgColumn`), `prescription_versions` (§19.2, `UNIQUE(prescription_id, version_number)`), `prescription_items` (§19.3, hang off version), `medication_records` (§20.1), `consultation_notes` (§21.1), `patient_claim_invites`/`patient_claim_events` (§9), `access_events` (§26.1). Source-document / `provenance_id` / `consent_id` columns carry no FK until their tables land (Phase 4/6). Generated SQL inspected: CREATE-only + post-create ALTERs; applied via `db:migrate`.

### WP3 — API foundations
`services/api/src/audit/log.ts` (`logAccess` — append-only insert). Doctor dashboard `draft_queue.pending` count. Doctor workspace `logAccess(VIEW)`. Route registration in `index.ts`.

### WP4 — Consultations (`services/api/src/consultations/routes.ts`)
`POST /doctor/appointments` (walk-in, CONFIRMED, overlap guard), `POST /doctor/encounters` (find-or-create), `GET /doctor/appointments/{id}/consultation` (self-contained bundle), `PUT /doctor/encounters/{id}/note` (upsert; `NOTE_FINALIZED`), `POST .../note/amend`. `appointments/routes.ts` `/complete` now finalizes the note + closes the encounter.

### WP5 — Prescriptions (`services/api/src/prescriptions/{routes,map,pdf}.ts`)
Draft CRUD (direct-entry only), finalize (transaction + `SELECT ... FOR UPDATE`, Idempotency-Key required, replay via draft state), amend (new version, never UPDATE), render (PDF bytes via `@react-pdf/renderer`), doctor GET. `GET /patients/self/prescriptions/{id}` in the same module.

### WP6 — Medications (`services/api/src/medications/{routes,derive}.ts`)
`GET /patients/self/medications` — union of `medication_records` + prescription items derived as `UNKNOWN_STATUS`.

### WP7 — Claims (`services/api/src/claims/routes.ts`)
`POST /doctor/patients/{id}/claim-invites` (raw token returned once, hashed via `hashIdentity`) + `POST /patient-claims` (public route, lazy `ensureProfile`, idempotent, INVITE_USED/EXPIRED/ACCOUNT_ALREADY_LINKED).

### WP8 — Web screens
Page 14 (`patient/book`, packet builder + scope summary), Page 11 (`patient/appointments`), Page 10 (`patient/medications`), Page 18 (`doctor/consultation/[appointmentId]`, autosave + complete/amend), Page 19 (`doctor/drafts`), Page 20 (`prescription-drafts/new`, `[draftId]`, `prescriptions/[prescriptionId]`), claim entry (`onboarding/claim`). Enabled Drafts nav + Page 17 consultation/prescription/claim-invite actions + Page 15 consult action. Shared `components/medicine-editor.tsx`.

### WP9 — Gate (`services/api/gate-phase3.mjs`)
36 checks; self-contained claim flow (no dependency on a pre-existing patient user).

## Contract extensions & deferrals

Extensions: `POST /doctor/appointments`, `POST /doctor/encounters`, `GET /doctor/appointments/{id}/consultation`, note PUT/amend, `DELETE /doctor/prescription-drafts/{id}`, `POST /doctor/patients/{id}/claim-invites`, `GET /doctor/prescriptions/{id}`, `GET /patients/self/appointments`, `access_events` write-side early, Page 14 scope = presentation only, medications derive `UNKNOWN_STATUS`, PDF returns bytes (signed URL Phase 4).

Deferrals: OCR/voice endpoints + document FKs (P4); access-ledger endpoint + consent checks + REVOKE (P6); `consultation_note_versions` (amendment rows suffice); `provenance_records`; allergies data (empty state); SMS invites (P7); reschedule (cancel + re-book); video join (non-goal); Idempotency-Key persistence table (replay via draft state — any re-finalize of an APPROVED draft replays the existing prescription).

## Gate

```text
npm install                                → clean
npm run db:generate                        → 0002 created; SQL inspected (CREATE-only + circular ALTER)
npm run db:check && npm run db:migrate     → 0002 applied
npm run dev                                → web :3000 + api :4000
curl localhost:4000/health                 → {"ok":true,"db":"up"}
npm run typecheck                          → pass
node services/api/gate-phase3.mjs          → 36/36 PASS
npm run build                              → web build green
```

## Risks

| Risk | Mitigation |
|---|---|
| Circular FK in drizzle-kit | `AnyPgColumn` callback; inspected SQL; emitted as post-create ALTER |
| `@react-pdf/renderer` interop (Node 24, react 19) | Smoke-tested `renderToBuffer`; gate asserts `%PDF-` magic bytes |
| Finalize race | `SELECT ... FOR UPDATE` inside `db.transaction` |
| `clerk.users.createUser` unavailable on trial instance | Hard stop + ask user (master-plan rule) — did not occur |
