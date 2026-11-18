# Implementation status

What works, what is partial, and what blocks release. Distilled from the 2026-10-25 design audit, gap batches 1–10, the Phase 6–8 logs and the 2026-11-18 UI audit.

Last verified: 2026-11-18. The Clear v2 migration (2026-11-14) changed presentation only, so the behaviour status below carries over unchanged.

## Summary

- **All 56 designed screens have a route** ([product/screen-map.md](product/screen-map.md)). **No screen is certified COMPLETE.** Fidelity was checked by eye against FigCraft, not measured.
- Every live API gate (Phases 3–8) passes except one stale leg in `gate-phase4.mjs` (see [history.md](history.md)).
- The latest recorded suite runs (2026-11-03): web 30, API 225 unit tests, 117 browser tests and 16 production-PWA tests passed. Re-run before quoting these numbers.

## Audit gaps (GAP-001 … 037)

From the original audit. "Fixed" means implemented and covered by synthetic tests. Live seeded-PostgreSQL acceptance has not been run for any of them.

| State | Gaps |
|---|---|
| **Fixed** | 001 fabricated dossier facts removed · 002 owner-only AI/session reads · 003 prescription replay authorization · 004 confirmation bound to saved reviewed items · 005 real checked safety outcome · 007 autosave flush before completion · 008 editable note amendments · 009 persistent emergency state · 024 per-line prescription review gate (`REVIEW_REQUIRED`) |
| **Partial** | 006 scoped consent (service exists, but packets aren't stored on appointments) · 010 doctor verification is advisory (demo policy) · 011 navigation · 013 booking (no persisted draft) · 014 check-in (fixed three-step flow, no full adaptive branching) · 015 result (no optional measurements or reanalysis) · 016 timeline (AI entries only, no non-AI detail) · 017 Vault · 018 medication provenance · 019 appointments (no video join) · 020 schedule (no clinic assignment) · 021 directory · 025 patient create (duplicate preflight missing) · 028 Care Circle (Message, View profile disabled) · 029 privacy ledger · 030–032 follow-ups, staff, memberships · 033 removal requests (decisions recorded, records not yet hidden) · 034 doctor profile |
| **Blocked on a missing service** | 012 booking packet and sharing receipt (needs packet scope, recipient and expiry storage) |
| **Open** | 022 consultation review composition · 023 draft-queue source filters and recovery · 026 auth/onboarding vs multi-workspace spec · 027 dashboard actions · 035 shared component standardisation · 036 full responsive + assistive-tech acceptance · 037 measurable screen acceptance gates |

## Known product limits

These are stated in the UI and not faked:

- **No allergy table.** Allergies show as unavailable. Persona A's amoxicillin reaction is recorded in a note and a medication record.
- **No interaction engine**, and no server-required dose or frequency.
- **Preview** shows the last saved draft, not a generated PDF.
- **Removal decisions** are recorded but don't yet hide records.
- **Notifications** exist for one event only (an accepted practice invitation). No email or SMS is sent anywhere.
- **Invitation contact matching:** the typed contact is compared with the invited contact, not with the verified account.
- **The staff schedule** shows one clinic day at a time (IST).
- **No destination yet:** a Contact Patient channel, a doctor photo picker, a credential-change request, and video or a waiting room.
- **Patient dock labels** (six items) truncate at 320 px.

## UI audit 2026-11-18

Dock pinning (F1) shipped in `31abd3c`. The remaining audit score was 14/20, weakest on responsive layout and accessibility. Six routes couldn't be audited with the mocks, because they returned `[]` where an object was expected: doctor home, doctor schedule, doctor profile, patient medications, patient privacy and staff schedule. Re-check them with shaped fixtures from `apps/web/e2e/dock.spec.ts`.

## Release blockers (human steps)

- [ ] Physical-phone acceptance of the signed APK and the installed PWA, including iOS Safari (only Chromium emulation has been tested).
- [ ] A+B+C rehearsal on a phone, plus a recording ([operations/demo-rehearsal.md](operations/demo-rehearsal.md)).
- [ ] An offsite database and Storage backup destination, plus a successful restore drill. The schedule exists but is disabled.
- [ ] An alert destination for API, worker, queue and certificate failures.
- [ ] Triage `npm audit` findings (31 reported on 2026-11-03: 3 critical, 5 high).
- [ ] Docker image builds have never been verified on a host with Docker. CI builds them.
