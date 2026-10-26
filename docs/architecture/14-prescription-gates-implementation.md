# Batch 8 — Prescription safety, ambiguity and preview gates (SCR-033/034/035, GAP-024)

## Scope and sources

Frames 3377 (SCR-033), 3524 (SCR-034) and 3590 (SCR-035) were compared through the existing exports ([3377](evidence/design-3377.png), [3524](evidence/design-3524.png), [3590](evidence/design-3590.png)) and the audit. The FigCraft MCP server did not connect, so frames were not re-fetched. Targets: INT-470–477, 493–503, 509.

## Routes and backend

| Screen | Route | Backend |
| --- | --- | --- |
| SCR-033 | `/app/doctor/prescription-drafts/[draftId]` | GET/PATCH draft; GET `/doctor/documents/:id` (source); GET `/doctor/patients/:id/workspace` (safety panel); POST finalize |
| SCR-034 | `/app/doctor/prescription-drafts/new` | POST `/doctor/encounters/:id/prescription-drafts` |
| SCR-035 | same draft route (dialog) | POST finalize |
| Preview (new) | `/app/doctor/prescription-drafts/[draftId]/preview` | GET draft only; read-only, labelled non-final |

Persistence: migration `0010_equal_sleepwalker.sql` adds `prescription_draft_items.reviewed_by_doctor_id` / `reviewed_at` and backfills `needs_review = false` for existing DIRECT_ENTRY lines (they were wrongly defaulting to flagged). Not applied to any database.

## Behaviour

- **Review decisions:** PATCH accepts `reviewed: true` per line. Only that clears a flag. Unchanged lines keep their flag and OCR confidence; changed or added lines in extracted drafts become flagged again. Direct-entry lines are never flagged. Confirming doctor and time are stored.
- **Server gate:** finalize returns 409 `REVIEW_REQUIRED` while any line is flagged, before the existing `DRAFT_CHANGED` check.
- **UI:** flagged lines show "Ambiguous · Confidence N%" and a "I checked medication N against the source" checkbox; editing a line clears its confirmation. Finalize saves, reloads the stored flags and refuses to open the review while any remain.
- **Final review:** checks for source (OCR drafts), allergies/current medicines, and printable preview must be ticked before the button enables; a link opens the preview in a new tab.
- **Source recovery:** load failure shows the error and `Retry source`; `Open original source →` for loaded documents.
- **Safety context:** the doctor's own current medicines, OCR confidence and extraction flags. States that allergy data is unavailable and that no interaction or dose-range check is performed.
- **SCR-034:** PREVIEW and FINALIZE added; FINALIZE opens the same review dialog (`?finalize=1`) and never finalizes on its own. Route/frequency/timing keep free text with suggestion lists.

## Not done (stated, not faked)

- No allergy source or interaction engine exists; none is implied.
- No server-enforced required dose/frequency: no specification defines them.
- The source/safety/preview checklist is a client-side acknowledgment, not persisted per prescription.
- The designed select controls are free text with suggestions.
- Preview shows the last saved draft, not a generated PDF.

## Verification

- Typecheck, lint (no errors) and `next build` pass. API: 193 tests (5 new in `prescriptions/review-gate.test.ts`). Web unit: 28 (1 new). Playwright `--workers=1`: **88 pass**, 7 new in `e2e/prescription-gates.spec.ts` (source retry, safety panel, flagged-line gating and PATCH payloads, server rejection, edit-resets-confirmation, preview, direct-entry flows, 320/768/1440 px with focus containment).
- Existing `clinical-workflows` tests were updated for the new checklist.
- Evidence: [SCR-033](evidence/implementation-scr-033-393.png), [SCR-035](evidence/implementation-scr-035-393.png). Browser tests use synthetic HTTP responses; no live Fastify/PostgreSQL run.
