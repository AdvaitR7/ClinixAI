# Screen map

Every designed screen and the route and file that implement it. Use this to go from a design frame or screen name to code, or the other way round.

Last verified: 2026-11-18. Every listed file exists.

- **ID**: stable screen ID. `A` account, `P` patient, `C` clinical (doctor), `S` practice and staff.
- **Frame**: the Clear v2 frame in [`design/ClinixAI-v2.figcraft`](../design/ClinixAI-v2.figcraft), written as `page/frame`, followed by the original pre-Clear frame. Pages: 7593 Account · 7594 Patient · 7595 Clinical · 7596 Practice & Staff.
- **Route**: dynamic records use `by-id?…` query routes. This is deliberate, because the Android static export can't enumerate IDs ([architecture/mobile.md](../architecture/mobile.md)).
- "Screen" numbers (1, 2a, 15b…) match [screen-catalog.md](screen-catalog.md).

| ID | Frame | Screen | Route — states | File |
|---|---|---|---|---|
| A01 | 7593/7915 · 163 | 1 · Sign in | `/sign-in` — default email/password form | `app/sign-in/page.tsx` |
| A02 | 7593/7953 · 199 | 2 · Patient / Sign up | `/sign-up` — form / confirmation-sent / existing-account | `app/sign-up/page.tsx` |
| A03 | 7593/8003 · 300 | 2a · Patient Onboarding | `/onboarding/patient` — required patient profile form | `app/onboarding/patient/page.tsx` |
| A04 | 7593/8038 · 350 | 2b · Doctor Onboarding | `/onboarding/doctor` — professional profile form | `app/onboarding/doctor/page.tsx` |
| A05 | 7593/8073 · 400 | 2c · Clinic Staff Invitation & Onboarding | `/onboarding/staff?token={token}` — OPEN / EXPIRED / REVOKED / USED / missing token / signed-out | `app/onboarding/staff/page.tsx` |
| P01 | 7594/8117 · 478 | 3 · Patient Dashboard | `/app/patient` — dashboard populated / empty | `app/app/patient/page.tsx` |
| P02 | 7594/8181 · 766 | 6 · AI Health Check-in | `/app/patient/checkin?encounterId={optional}` — start / active block / resume / analysis retry | `app/app/patient/checkin/page.tsx` |
| P03 | 7594/8227 · 815 | 6a · Red-flag Safety Interrupt | `/app/patient/checkin` — persistent blocking safety interrupt | `components/checkin-safety.tsx` |
| P04 | 7594/8254 · 843 | 7 · Check-in Result | `/app/patient/checkin/result/by-id?sessionId={id}` — checked outcome / pending / denied / failed / evidence dialogs | `components/route-pages/app-patient-checkin-result.tsx` |
| P05 | 7594/7597 · 951 | 8 · Health Timeline | `/app/patient/timeline` — ALL and existing source filters | `app/app/patient/timeline/page.tsx` |
| P06 | 7594/8361 · 1060 | 8a · Timeline Entry Detail | `/app/patient/timeline/checkins/by-id?sessionId={id}` — selected owned AI entry / evidence / error | `components/route-pages/app-patient-timeline-checkins.tsx` |
| P07 | 7594/8430 · 1130 | 9 · Health Vault & Document Hub | `/app/patient/vault` — sources / upload / extraction / correction / trends | `app/app/patient/vault/page.tsx` |
| P08 | 7594/8549 · 1249 | 9a · Source Preview Drawer | `/app/patient/vault` — source preview drawer inside VaultDialog | `components/vault-source-preview.tsx` |
| P09 | 7594/8609 · 1310 | 10 · Medication History | `/app/patient/medications` — registry / filters | `app/app/patient/medications/page.tsx` |
| P10 | 7594/8794 · 1495 | 10a · Medication Detail | `/app/patient/medications` — selected medication detail in VaultDialog | `app/app/patient/medications/page.tsx` |
| P11 | 7594/8853 · 1555 | 11 · Patient Appointments | `/app/patient/appointments` — Upcoming / Past / Cancelled / cancel-rebook dialog | `app/app/patient/appointments/page.tsx` |
| P12 | 7594/9000 · 1703 | 12 · Care Circle & Directory | `/app/patient/care` — My Doctors tab | `app/app/patient/care/page.tsx` |
| P13 | 7594/9129 · 1832 | 12a · Discover Doctors | `/app/patient/care` — Discover tab | `app/app/patient/care/page.tsx` |
| P14 | 7594/9241 · 1944 | 12b · Consent Scope Picker | `/app/patient/care/share/by-id?doctorId={id}&from={optional}&encounterId={optional}` — scope selection / review confirmation | `components/route-pages/app-patient-care-share.tsx` |
| P15 | 7594/9317 · 2021 | 13 · Privacy & Access Ledger | `/app/patient/privacy` — permissions / category cursor ledger / removal requests | `app/app/patient/privacy/page.tsx` |
| P16 | 7594/9438 · 5617 | 13a · Access Receipt Detail | `/app/patient/privacy/access/by-id?eventId={id}` — selected access receipt / error | `components/route-pages/app-patient-privacy-access.tsx` |
| P17 | 7594/9507 · 5686 | 13b · Revoke Consent Confirmation | `/app/patient/privacy` — Permissions revoking confirmation | `app/app/patient/privacy/page.tsx` |
| P18 | 7594/9576 · 2143 | 14 · Consultation Booking & Packet Builder | `/app/patient/book?doctorId={optional}&rebook={optional}&consentId={optional}&encounterId={optional}` — doctor / mode / keyed slots / reason / sharing | `app/app/patient/book/page.tsx` |
| P19 | 7594/9688 · 2255 | 14a · Review Consultation Booking | `/app/patient/book` — BookingForm review=true | `app/app/patient/book/page.tsx` |
| C01 | 7595/9749 · 594 | 4 · Doctor Dashboard | `/app/doctor` — dashboard / incoming decisions | `app/app/doctor/page.tsx` |
| C02 | 7595/9829 · 2317 | 15 · Doctor Schedule | `/app/doctor/schedule?tab=schedule&view={day\|week}&date={date}&status={optional}` — day/week/date/status schedule | `app/app/doctor/schedule/page.tsx` |
| C03 | 7595/9965 · 2453 | 15a · Doctor Availability | `/app/doctor/schedule?tab=availability` — AvailabilityForm and hours/break/online/blocked/override dialogs | `components/doctor-availability.tsx` |
| C04 | 7595/10060 · 2548 | 15b · Appointment Consultation Context | `/app/doctor/schedule/by-id?appointmentId={id}&{calendar-query}` — selected appointment context | `components/route-pages/app-doctor-schedule.tsx` |
| C05 | 7595/10120 · 2609 | 16 · Patient Directory | `/app/doctor/patients?q={optional}&filter={optional}` — Recent / Upcoming / Unclaimed and query | `app/app/doctor/patients/page.tsx` |
| C06 | 7595/10233 · 2722 | 16a · Patient Clinical Workspace | `/app/doctor/patients/by-id/context?patientId={id}` — DoctorPatientRecord compact=true | `components/doctor-patient-record.tsx` |
| C07 | 7595/10299 · 2789 | 17 · Patient Clinical Workspace | `/app/doctor/patients/by-id?patientId={id}` — DoctorPatientRecord full dossier | `components/doctor-patient-record.tsx` |
| C08 | 7595/10475 · 2966 | 18 · Consultation Workspace | `/app/doctor/consultation/by-id?appointmentId={id}` — editing / autosave / complete / amendment | `components/route-pages/app-doctor-consultation.tsx` |
| C09 | 7595/10612 · 3103 | 18a · Complete Consultation Confirmation | `/app/doctor/consultation/by-id?appointmentId={id}` — confirmComplete ClinicalReviewDialog | `components/route-pages/app-doctor-consultation.tsx` |
| C10 | 7595/10666 · 3158 | 19 · Prescription Draft Queue | `/app/doctor/drafts` — existing status filters and ranked list | `app/app/doctor/drafts/page.tsx` |
| C11 | 7595/7706 · 3377 | 20 · Prescription Workspace / OCR Review | `/app/doctor/prescription-drafts/by-id?draftId={id}` — saved OCR/voice/manual draft review | `components/route-pages/app-doctor-prescription-drafts.tsx` |
| C12 | 7595/10884 · 3524 | 20a · Prescription Workspace / Direct | `/app/doctor/prescription-drafts/new?encounterId={id}&patientId={id}` — direct new draft | `app/app/doctor/prescription-drafts/new/page.tsx` |
| C13 | 7595/10950 · 3590 | 20b · Prescription Finalization Confirmation | `/app/doctor/prescription-drafts/by-id?draftId={id}&finalize={optional}` — confirming final review | `components/route-pages/app-doctor-prescription-drafts.tsx` |
| C14 | 7595/11004 · 3645 | 21 · Follow-up Worklist | `/app/doctor/followups` — FollowupWorklist doctor base | `components/followups.tsx` |
| C15 | 7595/11508 · 4149 | 21a · Follow-up Task Detail | `/app/doctor/followups/by-id?id={id}` — FollowupDetail isDoctor=true | `components/followups.tsx` |
| C16 | 7595/11651 · 4293 | 22 · Add Clinic Patient | `/app/doctor/patients/new` — identity form stage | `app/app/doctor/patients/new/page.tsx` |
| C17 | 7595/11730 · 4372 | 22a · Duplicate Resolution | `/app/doctor/patients/new` — duplicate conflict after create returns409 | `app/app/doctor/patients/new/page.tsx` |
| C18 | 7595/11795 · 4437 | 22b · Confirm Clinic Patient | `/app/doctor/patients/new` — review=true pre-create | `app/app/doctor/patients/new/page.tsx` |
| C19 | 7595/11858 · 4500 | 22c · Patient Created → Workspace | `/app/doctor/patients/new` — created success state | `app/app/doctor/patients/new/page.tsx` |
| S01 | 7596/11893 · 4536 | 23 · Clinic Staff Dashboard / Receptionist | `/app/staff` — dashboard role RECEPTION | `app/app/staff/page.tsx` |
| S02 | 7596/12044 · 4687 | 23a · Clinic Staff Dashboard / Clinical Assistant | `/app/staff` — dashboard role ASSISTANT | `app/app/staff/page.tsx` |
| S03 | 7596/12212 · 4856 | 24 · Patient Intake Workspace | `/app/staff/intake/by-id?appointmentId={id}&practice_id={id}` — clinical_intake_locked=false | `components/route-pages/app-staff-intake.tsx` |
| S04 | 7596/12336 · 4980 | 24a · Receptionist Arrival-Only Access | `/app/staff/intake/by-id?appointmentId={id}&practice_id={id}` — clinical_intake_locked=true | `components/route-pages/app-staff-intake.tsx` |
| S05 | 7596/12370 · 5015 | 25 · Practice Team & Memberships | `/app/doctor/team` — practice creation / team list / invitation / management | `app/app/doctor/team/page.tsx` |
| S06 | 7596/12534 · 5179 | 25a · Confirm Role Change | `/app/doctor/team` — pending.kind=role | `app/app/doctor/team/page.tsx` |
| S07 | 7596/12557 · 5202 | 25b · End Membership Confirmation | `/app/doctor/team` — pending.kind=end | `app/app/doctor/team/page.tsx` |
| S08 | 7596/12587 · 5233 | 26 · Record Removal & Retention Requests | `/app/doctor/requests` — list/filter/RequestDetail decision form | `app/app/doctor/requests/page.tsx` |
| S09 | 7596/12706 · 5352 | 26a · Confirm Retention Decision | `/app/doctor/requests` — confirming with PARTIALLY_APPROVED | `app/app/doctor/requests/page.tsx` |
| S10 | 7596/12750 · 5755 | 26a-2 · Confirm Retention Decision (retain) | `/app/doctor/requests` — confirming with DENIED (retain) | `app/app/doctor/requests/page.tsx` |
| S11 | 7596/12794 · 5799 | 26a-3 · Confirm Removal Decision (approve) | `/app/doctor/requests` — confirming with APPROVED | `app/app/doctor/requests/page.tsx` |
| S12 | 7596/12838 · 5396 | 26b · Staff Route Request | `/app/staff/requests` — practice member request routing | `app/app/staff/requests/page.tsx` |
| S13 | 7596/12881 · 5440 | 27 · Doctor Profile & Consultation Services | `/app/doctor/profile` — ProfileForm edit / saving / saved / error | `app/app/doctor/profile/page.tsx` |

File paths are relative to `apps/web/src/`.

## Routes outside the 56 designed screens

| Route | Purpose | File |
|---|---|---|
| `/` | Entry redirect by session and role | `app/page.tsx` |
| `/after-sign-in` | Resolves `/me` and routes to the right workspace | `app/after-sign-in/page.tsx` |
| `/auth/callback` | Supabase PKCE exchange for confirm and recovery links | `app/auth/callback/page.tsx` |
| `/forgot-password`, `/reset-password` | Password recovery | `app/forgot-password/`, `app/reset-password/` |
| `/onboarding/role`, `/onboarding/claim` | Role choice; patient claims a doctor-created record by code | `app/onboarding/role/`, `app/onboarding/claim/` |
| `/settings` | Account, workspace switch, install app (patient "You" dock item) | `app/settings/page.tsx` |
| `/notifications` | Notification list | `app/notifications/page.tsx` |
| `/~offline` | Service-worker offline fallback | `app/~offline/page.tsx` |
| `/app/doctor/practice` | Practice settings | `app/app/doctor/practice/page.tsx` |
| `/app/doctor/prescriptions/by-id` | Finalized prescription (immutable versions) | `components/route-pages/app-doctor-prescriptions.tsx` |
| `/app/doctor/prescription-drafts/by-id/preview` | Printable non-final preview | `components/route-pages/app-doctor-prescription-drafts-preview.tsx` |
| `/app/staff/schedule`, `/app/staff/book` | Clinic day schedule; staff booking | `app/app/staff/schedule/`, `app/app/staff/book/` |
| `/app/staff/patients/new`, `/app/staff/claims` | Staff registers a patient; claim invitations | `app/app/staff/patients/new/`, `app/app/staff/claims/` |
| `/app/staff/followups`, `/app/staff/followups/by-id` | Staff follow-up worklist and detail | `app/app/staff/followups/`, `components/route-pages/app-staff-followups.tsx` |
| `/app/staff/receipt/by-id` | Payment receipt | `components/route-pages/app-staff-receipt.tsx` |
