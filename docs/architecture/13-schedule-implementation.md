# Batch 7 — Doctor schedule, availability and appointment context (SCR-024/025/026)

## Scope and sources

FigCraft frames 2317 (SCR-024), 2453 (SCR-025) and 2548 (SCR-026) were compared with the existing audit ([design-2317](evidence/design-2317.png), [design-2453](evidence/design-2453.png), [design-2548](evidence/design-2548.png)). Interaction IDs INT-325–INT-384 are the targets. The FigCraft MCP server failed to connect in the resumed session, so no frame was re-fetched; the existing frame exports and audit were used.

## Routes and backend

| Screen | Route | Backend |
| --- | --- | --- |
| SCR-024 | `/app/doctor/schedule?date&view&status` | `GET /doctor/appointments`; POST confirm / cancel / payment-status |
| SCR-025 | `/app/doctor/schedule?tab=availability` | **new** `GET /doctors/self/availability`; `PUT /doctors/self/availability` (transactional, takes the doctor row lock used by booking) |
| SCR-026 | `/app/doctor/schedule/[appointmentId]` | selects an owned row from `GET /doctor/appointments` (does **not** call the consultation GET, so no encounter is created); `GET /doctor/patients/:id/workspace` only for the record link |

Persistence: migration `0009_tearful_tarot.sql` adds `doctor_availability.rules` (jsonb: breaks, blocked dates, one-off overrides, online template). Slot generation (`availability/slots.ts`) applies the rules; schemas live in `packages/schemas`. The migration has **not** been applied to any database.

## What changed

- SCR-024: day/week toggle, five-day date strip and date input (India time), status filters, row links to context. URL carries date/view/status so Back/Close return to the same calendar.
- SCR-025: loads the saved configuration, per-day multi-window editor, breaks, online hours, blocked dates, one-off overrides, validation, failed save keeps edits, success is confirmed by read-back.
- SCR-026: appointment summary, payment/consultation state, honest packet and snapshot sections, START CONSULTATION (CONFIRMED only), OPEN PATIENT RECORD (only when the authorized read succeeds).

## Still not done (stated, not faked)

- **Clinic assignment (INT-368):** no practice/location service exists; the field renders `Practice location service unavailable`.
- **Consultation packet Open → (INT-380–382):** rendered disabled; there is no scoped packet, recipient or expiry service. Allergies show "unavailable".
- **"You" nav (INT-342/377)** and the profile menu (INT-325) have no destination in the specs.
- Video join / waiting room are not available.
- Dashboard "Open" rows (INT-075–078, SCR-007) were not changed in this batch.

## Verification

- `npm run typecheck` (web/API/worker): pass. `npm run lint -w @clinix/web`: no errors.
- API tests: 188 pass (includes `availability/schedule.test.ts`). Web unit tests: 27 pass.
- `npm run build -w @clinix/web`: pass.
- Playwright `--workers=1`: **81 pass**, including 9 in `e2e/schedule-workflows.spec.ts` (calendar state, fail-closed context, mutation failures and focus return, saved-rule round trip, editors, read-failure retry, 320/768/1440 px overflow).
- Evidence: [SCR-024](evidence/implementation-scr-024-393.png), [SCR-026](evidence/implementation-scr-026-393.png). Browser tests use synthetic HTTP responses, not a live Fastify/PostgreSQL stack; the slot rules are unit-tested only through Fastify injection and pure functions.
- Fixes during this run: tab/view labels were lowercase in the DOM (now proper case); the spec was updated for the Next route announcer's `role="alert"` and a navigation race.
