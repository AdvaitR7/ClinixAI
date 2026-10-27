# Batch 9 — Privacy: consent, access ledger, removal (SCR-018/019/020/021/049/050/051; GAP-006/012/028/029/033)

## Scope and sources

Master build plan Phase 6. Frames 1703, 1832, 1944, 2021, 5233, 5352 and 5396 were compared through the existing exports ([1703](evidence/design-1703.png), [1832](evidence/design-1832.png), [1944](evidence/design-1944.png), [2021](evidence/design-2021.png), [5233](evidence/design-5233.png), [5352](evidence/design-5352.png), [5396](evidence/design-5396.png)). Specs: API §16, §28, §29, §36; DB §25–27. Interaction targets: INT-226–295, 682–700.

## Design additions (FigCraft, "ClinixAI v2")

Existing frames are untouched. New states were cloned from the nearest frame and re-worded, then exported:

| Frame | Page | State | Export |
| --- | --- | --- | --- |
| 5617 · Page 13a / Access Receipt Detail | Page 13 | Detail for a ledger event (basis, purpose, authorization) | [design-5617](evidence/design-5617.png) |
| 5686 · Page 13b / Revoke Consent Confirmation | Page 13 | Confirm revoke, ledger note, change scope instead | [design-5686](evidence/design-5686.png) |
| 5755 · Page 26a-2 / Confirm Retention Decision (retain) | Page 26 | SCR-050 retain variant | [design-5755](evidence/design-5755.png) |
| 5799 · Page 26a-3 / Confirm Removal Decision (approve) | Page 26 | SCR-050 approve variant | [design-5799](evidence/design-5799.png) |

The access-receipt frame is design only: the ledger rows show no receipt link in code (destination previously unknown), so no screen implements it yet. Revoke confirmation is implemented as the dialog on SCR-021. Consent-locked, empty/error and patient removal-request frames were not drawn; code renders those states.

## Routes and backend

| Screen | Route | Backend |
| --- | --- | --- |
| SCR-018 | `/app/patient/care` | `GET /patients/self/doctors`, `GET /patients/self/consents`, `DELETE /patients/self/doctors/:id/relationships` |
| SCR-019 | `/app/patient/care` (Discover tab) | `GET /doctors?verified_only=true&q=`, relationship upsert (grants nothing) |
| SCR-020 | `/app/patient/care/share/[doctorId]` (`?from=book`, `?encounterId=`) | `POST /patients/self/consents/preview`, `POST /patients/self/consents` |
| SCR-021 | `/app/patient/privacy` | `GET /patients/self/consents`, `POST …/consents/:id/revoke`, `GET /patients/self/access-ledger?category&cursor`, removal request create/list |
| SCR-049/050 | `/app/doctor/requests` | `GET /doctor/record-removal-requests`, `POST …/:id/resolve` |
| SCR-051 | `/app/staff/requests` | none: staff routing refused (`PRACTICE_MEMBERSHIP_REQUIRED`) |

Persistence: migration `0011_mean_epoch.sql` adds `consents`, `consent_scopes`, `record_removal_requests` and the `access_events.consent_id` FK; `0012_access_events_append_only.sql` revokes UPDATE/DELETE/TRUNCATE from non-owner roles and adds a trigger that rejects UPDATE/DELETE for every role. **Neither is applied to any database.** Also not applied: 0009 and 0010 from batches 7–8.

## Behaviour

- **Relationship is not permission.** A doctor always sees their own authored records. Patient-held and other clinicians' records open only through an ACTIVE, unexpired, unrevoked consent whose scope covers them (`authorizePatientResource`, `privacy/consent.ts`). Expiry is derived at read time (`expires_at <= now`); revoke is idempotent and never erases doctor-authored records.
- **Scope groups:** ENCOUNTER, DOCUMENT, MEDICATION, TIMELINE, CHECKIN_PACKET, whole group or one record id. Allergy and mental wellness have no data source and are shown disabled with the reason. Expiry options: 7 days, 30 days, until withdrawn.
- **Workspace:** `GET /doctor/patients/:id/workspace` composes own records plus consented groups, returns `locked_sections` for every uncovered group (never silent omission), real `consent_active` and `access_scope`, and writes the ledger row with `consent_id`. A consenting doctor without a relationship is allowed; the relationship check applies to own records only.
- **Other reads:** doctor source document, doctor AI assistance (consented CHECKIN_PACKET only; encounter and patient routes) and the consultation medication list use the same helper and log the consent id. Unrelated doctors get 404/403 without existence leaks.
- **Booking:** `consent_id` is accepted and must be an active consent of this patient for the chosen doctor (`CONSENT_INVALID` otherwise). `packet_id` is still refused. The booking page shows the shared scope and expiry, or links to the scope picker; it no longer carries fake disabled packet rows.
- **Ledger:** human-readable events (actor name, action, purpose, resource), categories Clinical/Admin/AI, counts, cursor paging. Routine patient self-reads are hidden; share, revoke and removal requests stay visible.
- **Removal:** a request only records intent. Only the addressed doctor resolves it; replay of the same outcome is idempotent, a different outcome is 409. Partial approval and retention require a written reason; partial approval records per-record outcomes. The decision is ledgered.
- **Navigation:** the patient "Care" dock item now opens Care Circle instead of medications.

## Not done (stated, not faked)

- Resolving a removal request records the decision only; no records are hidden from patient or doctor views (no visibility flag exists). The patient sees this stated.
- Staff routing (SCR-051) needs practice membership (Phase 7); the screen says so and the API refuses staff. A doctor can re-route via `POST /record-removal-requests/:id/route`; no UI uses it.
- Access receipt and AI inference audit detail screens, Message, View profile and "You" remain unbuilt or disabled.
- Removal requests target a record type, not a chosen record. Practice-owner resolution is Phase 7.
- Consent is not stored on the appointment; booking only validates the reference.
- Allergy, mental wellness and clinic location data do not exist.
- Live PostgreSQL, RLS and role-privilege behaviour of 0011/0012 is unverified; `gate-phase6.mjs` is written but not run.

## Verification

- Typecheck (web, api, worker), lint and `next build` pass. API: 216 tests (23 new: privacy/consent, privacy/routes; updated workspace, AI, document, booking, consultation tests). Web unit: 28. Playwright `--workers=1`: **100 pass** (88 before; 11 new tests in `e2e/privacy-workflows.spec.ts` (care circle, discover, scope picker, booking return, privacy/ledger/revoke/removal, doctor decision and partial approval, staff boundary, 320/768/1440 px; one new booking test) and updated booking, check-in and record specs.
- Evidence: [SCR-018](evidence/implementation-scr-018-393.png), [SCR-019](evidence/implementation-scr-019-393.png), [SCR-020](evidence/implementation-scr-020-393.png), [SCR-021](evidence/implementation-scr-021-393.png), [SCR-049](evidence/implementation-scr-049-393.png), [SCR-050](evidence/implementation-scr-050-393.png), [SCR-051](evidence/implementation-scr-051-393.png). Browser tests use synthetic HTTP responses; no live Fastify/PostgreSQL run.
- `services/api/gate-phase6.mjs` (live): consent grant/revoke vs workspace, ledger row with consent id, DB-rejected UPDATE/DELETE on `access_events`, removal request and resolution. `gate-phase5.mjs` now grants consent before expecting doctor AI assistance.
