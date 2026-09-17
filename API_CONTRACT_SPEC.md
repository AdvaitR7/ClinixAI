# CliniX AI — API Contract Specification v0.1

> Backend contract derived from `CONTEXT.md`, `ARCHITECTURE_SPEC.md`, and `DATABASE_SCHEMA_SPEC.md`.
>
> Recommended backend: **FastAPI** with `/api/v1` as the public prefix.

## 1. API rules

Authentication uses Supabase Auth JWTs. FastAPI verifies the bearer token and resolves the user's application profile and role. Never trust a role or patient/doctor ID supplied by the client when it can be derived from the authenticated identity.

Every request gets an `X-Request-ID`. Operations that must not duplicate accidentally—appointment creation, record claiming, prescription finalization, AI-analysis start—also support an `Idempotency-Key` header.

Errors use a consistent envelope:

```json
{
  "error": {
    "code": "CONSENT_REQUIRED",
    "message": "Access to this patient record is not authorized.",
    "request_id": "..."
  }
}
```

## 2. Current user

### `GET /me`

Patient response:

```json
{
  "profile_id": "uuid",
  "role": "PATIENT",
  "patient_id": "uuid",
  "doctor_id": null
}
```

Doctor response also includes `doctor_id` and `verification_status`.

## 3. Patient account

### `POST /patients/self`

Creates the patient domain entity after signup.

```json
{
  "full_name": "Synthetic Patient",
  "phone": "+91...",
  "date_of_birth": "1997-04-12",
  "sex_at_registration": "..."
}
```

Backend creates `patients` plus encrypted `patient_identity`.

### `GET /patients/self`

Returns patient profile metadata, not the whole health record.

### `PATCH /patients/self`

Updates permitted patient-controlled identity/preferences. Sensitive changes produce audit events.

## 4. Doctor account

### `POST /doctors/self`

```json
{
  "registration_number": "12345",
  "registration_authority": "Example Medical Council",
  "qualification": "MBBS",
  "speciality": "General Medicine"
}
```

Prototype may use verified demo accounts or `PENDING` verification.

### `GET /doctors/self`

Returns doctor profile and verification state.

## 5. Doctor-created patient

### `POST /doctor/patients`

Authorization: doctor or authorized clinic staff.

```json
{
  "full_name": "Synthetic Patient",
  "mobile": "+91...",
  "date_of_birth": "1990-01-01",
  "sex_at_registration": "..."
}
```

Backend flow:

```text
create patient(status=UNCLAIMED)
        ↓
store encrypted identity
        ↓
create doctor/patient relationship
        ↓
optionally create record-claim invitation
```

## 6. Patient record claim

### `POST /patient-claims`

```json
{
  "invite_token": "..."
}
```

The endpoint checks hashed token, expiry, verified identity match, duplicate-account conflict, and whether the record is already claimed. It must be idempotent.

## 7. Doctor relationships

### `GET /patients/self/doctors`

Returns the patient's doctor relationships and preferred/regular doctor.

### `POST /patients/self/doctors/{doctor_id}/relationships`

```json
{
  "relationship_type": "PRIMARY_PHYSICIAN",
  "preferred": true
}
```

## 8. Encounters

### `POST /patients/self/encounters`

```json
{
  "encounter_type": "AI_SELF_CARE",
  "chief_concern": "I have cough again"
}
```

Returns an `encounter_id`. All later AI questions, appointment booking, doctor review, prescription and follow-up can remain attached to this encounter.

### `GET /patients/self/encounters/{encounter_id}`

Returns patient-visible encounter state. Internal AI orchestration remains separately namespaced.

## 9. Adaptive questioning

### `POST /encounters/{encounter_id}/interaction/start`

Creates an interaction session, runs a basic safety pre-check and returns a structured UI block.

```json
{
  "interaction_session_id": "uuid",
  "block": {
    "id": "uuid",
    "block_type": "single_select",
    "title": "How long have you had the cough?",
    "options": [
      {"id": "lt_1d", "label": "Less than 24 hours"},
      {"id": "1_3d", "label": "1–3 days"},
      {"id": "gt_3d", "label": "More than 3 days"}
    ],
    "allow_free_text": true
  }
}
```

### `POST /interactions/{session_id}/responses`

```json
{
  "block_id": "uuid",
  "selected_option_ids": ["1_3d"],
  "free_text": null
}
```

Response state is one of:

```text
NEEDS_MORE_INFORMATION
READY_FOR_ANALYSIS
SAFETY_ESCALATION
```

## 10. AI analysis

### `POST /encounters/{encounter_id}/ai-analysis`

Idempotent. Backend flow:

```text
build minimum-necessary Evidence Bundle
        ↓
pseudonymize
        ↓
deterministic pre-check
        ↓
Analyst 1 ┐
          ├ run independently/in parallel
Analyst 2 ┘
        ↓
Judge
        ↓
deterministic post-check
        ↓
persist AI-derived records
        ↓
patient-safe output
```

For non-trivial latency, return `202 Accepted`:

```json
{
  "ai_session_id": "uuid",
  "status": "RUNNING"
}
```

### `GET /ai-sessions/{ai_session_id}`

Returns patient-safe result only. Do not expose raw hidden reasoning.

### `GET /ai-sessions/{ai_session_id}/evidence`

Returns verifiable source references used for explanations, such as a historical encounter, prescription or report.

## 11. Document upload

### `POST /patients/self/documents/upload-init`

```json
{
  "filename": "lab-report.pdf",
  "mime_type": "application/pdf",
  "document_type": "LAB_REPORT",
  "encounter_id": null
}
```

Returns short-lived signed upload URL and `document_id`.

### `POST /patients/self/documents/{document_id}/upload-complete`

Validates the private-storage object and queues document processing.

### `GET /patients/self/documents/{document_id}`

Returns authorized metadata plus a short-lived signed view/download URL.

## 12. Laboratory reports

### `GET /patients/self/lab-reports/{report_id}`

Example:

```json
{
  "report_id": "uuid",
  "collection_date": "2026-09-01",
  "source_document_id": "uuid",
  "observations": [
    {
      "test_name": "HbA1c",
      "value_numeric": 6.1,
      "unit": "%",
      "confidence": 0.96
    }
  ]
}
```

Values remain linked to the original document/page and extraction provenance.

## 13. Patient timeline

### `GET /patients/self/timeline`

Supports cursor pagination and optional type filters. It is a projection over encounters, appointments, prescriptions, reports and follow-ups—not a source-of-truth table.

## 14. Doctor availability

### `GET /doctors/{doctor_id}/availability`

Example query:

```text
?from=2026-09-17&to=2026-09-24&type=IN_PERSON
```

Returns selectable time slots.

## 15. Appointment booking

### `POST /patients/self/appointments`

```json
{
  "doctor_id": "uuid",
  "encounter_id": "uuid",
  "appointment_type": "IN_PERSON",
  "scheduled_start": "2026-09-17T17:30:00+05:30",
  "reason": "Recurring cough",
  "consent_id": "uuid"
}
```

### `POST /doctor/appointments/{appointment_id}/confirm`

Confirms booking.

### `POST /doctor/appointments/{appointment_id}/payment-status`

Manual payment tracking only.

```json
{
  "payment_status": "PAID",
  "reference_note": "Paid at clinic"
}
```

### `POST /doctor/appointments/{appointment_id}/complete`

Marks consultation complete.

## 16. Consent preview and creation

### `POST /patients/self/consents/preview`

Given a doctor and encounter, backend proposes minimum-necessary scopes.

Example response:

```json
{
  "suggested_scopes": [
    {"resource_type": "ALLERGY", "label": "Known allergies", "recommended": true},
    {"resource_type": "MEDICATION", "label": "Current medications", "recommended": true},
    {"resource_type": "MENTAL_WELLNESS", "label": "Mental wellness history", "recommended": false}
  ]
}
```

### `POST /patients/self/consents`

Creates actual scoped authorization.

### `POST /patients/self/consents/{consent_id}/revoke`

Revokes applicable future vault access. It does not erase professional records already created by the doctor.

## 17. Doctor patient workspace

### `GET /doctor/patients/{patient_id}/workspace`

This endpoint does not expose the entire patient database. The backend composes only data the doctor is authorized to see for the stated consultation context.

Possible response sections:

```text
patient identity needed for care
current encounter
allergies
current medications
relevant history
relevant labs
source documents
```

Sensitive reads create access-ledger entries.

## 18. Doctor AI-assistance view

### `GET /doctor/encounters/{encounter_id}/ai-assistance`

Returns AI-derived information separately from factual record:

- historical matches,
- analyst agreement summary,
- material disagreement,
- missing information,
- uncertainty,
- source references.

AI output never writes itself into doctor diagnosis or consultation note.

## 19. Prescription Mode A — direct digital

### `POST /doctor/encounters/{encounter_id}/prescription-drafts`

```json
{
  "source": "DIRECT_ENTRY",
  "items": [
    {
      "medicine_name": "Example medicine",
      "strength": "500 mg",
      "dose": "1 tablet",
      "frequency": "Twice daily",
      "timing": "After food",
      "duration": "3 days"
    }
  ]
}
```

Everything starts as a draft until doctor finalization.

## 20. Prescription Mode B — paper/OCR

### `POST /doctor/prescription-drafts/ocr`

```json
{
  "patient_id": "uuid",
  "encounter_id": "uuid",
  "document_id": "uuid"
}
```

Worker flow:

```text
private document
      ↓
OCR / vision extraction
      ↓
strict structured schema
      ↓
field-confidence + risk flags
      ↓
draft queue
      ↓
NEEDS_REVIEW
```

## 21. Prescription Mode C — voice

### `POST /doctor/prescription-drafts/voice`

```json
{
  "patient_id": "uuid",
  "encounter_id": "uuid",
  "audio_document_id": "uuid"
}
```

Worker flow:

```text
audio
  ↓
speech-to-text
  ↓
structured medication extraction
  ↓
field validation
  ↓
draft queue
```

Mode B and Mode C converge on the same draft-review UI.

## 22. Doctor draft queue

### `GET /doctor/prescription-drafts?status=NEEDS_REVIEW`

Returns patient, source mode, confidence and risk flags.

### `GET /doctor/prescription-drafts/{draft_id}`

Returns structured items and source references.

### `PATCH /doctor/prescription-drafts/{draft_id}`

Doctor corrects the draft.

## 23. Finalize prescription

### `POST /doctor/prescription-drafts/{draft_id}/finalize`

Requires authenticated doctor action and idempotency key.

Backend:

```text
lock draft
   ↓
validate doctor authority
   ↓
validate required fields
   ↓
create prescription
   ↓
create immutable version 1
   ↓
create prescription items
   ↓
mark draft APPROVED
   ↓
audit
```

No AI service may call this as the approving actor.

## 24. Amend prescription

### `POST /doctor/prescriptions/{prescription_id}/amend`

Creates Version N+1 with an amendment reason. Never mutate a finalized version in place.

## 25. Render/print prescription

### `POST /doctor/prescriptions/{prescription_id}/render`

Returns a generated prescription document and short-lived signed URL.

## 26. Patient prescription view

### `GET /patients/self/prescriptions/{prescription_id}`

Patient can view, print or download permitted finalized prescriptions but cannot edit them.

## 27. Medication history

### `GET /patients/self/medications`

Response distinguishes:

```text
CURRENT
PAST
UNKNOWN_STATUS
```

A historical prescription must not automatically be treated as current medication use.

## 28. Access ledger

### `GET /patients/self/access-ledger`

Example event:

```json
{
  "timestamp": "...",
  "actor": {
    "type": "DOCTOR",
    "display_name": "Dr. Sharma"
  },
  "purpose": "Consultation",
  "action": "VIEW",
  "resource_label": "Respiratory encounter"
}
```

The patient should see meaningful human-readable events without exposing internal infrastructure secrets.

## 29. Record-removal requests

### `POST /patients/self/record-removal-requests`

```json
{
  "target_actor_type": "DOCTOR",
  "target_actor_id": "uuid",
  "resource_type": "PRESCRIPTION",
  "resource_id": "uuid",
  "reason": "..."
}
```

This creates a request, not an automatic deletion.

### `POST /doctor/record-removal-requests/{request_id}/resolve`

Possible outcomes:

```text
APPROVED
PARTIALLY_APPROVED
DENIED
```

## 30. Follow-ups

### `POST /doctor/encounters/{encounter_id}/followups`

Creates a due follow-up.

### `GET /patients/self/followups`

Returns patient-visible upcoming follow-ups.

## 31. Doctor dashboard

### `GET /doctor/dashboard`

Composite response:

- today's appointments,
- pending prescription drafts,
- high-risk/ambiguous drafts,
- follow-ups due,
- incoming appointment requests.

## 32. Patient dashboard

### `GET /patients/self/dashboard`

Composite response:

- upcoming appointment,
- preferred doctor,
- recent timeline,
- pending follow-ups,
- recent report.

## 33. Internal AI service boundary

Do not expose raw model-orchestration endpoints to browsers.

Public client calls:

```text
POST /encounters/{id}/ai-analysis
```

Internal backend may use functions/endpoints conceptually equivalent to:

```text
build-evidence
run-analyst-1
run-analyst-2
run-judge
compose-output
```

## 34. Model Gateway abstraction

Application code should not depend directly on 9Router.

Conceptual interface:

```python
class ModelGateway:
    async def generate_structured(
        self,
        *,
        role: str,
        schema: type,
        messages: list,
        route: str,
    ):
        ...
```

Prototype adapter:

```text
NineRouterGateway
```

Future adapters may include India-region managed inference or self-hosted vLLM. The rest of CliniX should not change when the model provider changes.

## 35. Background jobs

Recommended events:

```text
document.uploaded
document.extract
lab.normalize
prescription.ocr.extract
prescription.voice.transcribe
semantic.embed
notification.create
```

Workers receive resource IDs, not giant document bodies in queue messages.

## 36. Authorization helper

Every sensitive backend request should resolve:

```text
Who is asking?
What resource?
For which patient?
For what purpose?
Does role permit the action?
Is active consent/relationship/encounter context required?
```

Then log the access.

Conceptual helper:

```python
authorize_patient_resource(
    actor=context,
    patient_id=patient_id,
    resource_type="LAB_REPORT",
    resource_id=report_id,
    action="READ",
    purpose="CONSULTATION",
)
```

## 37. Logging rule

Do not put sensitive medical content into routine infrastructure logs.

Prefer:

```text
request_id=...
actor_profile_id=...
patient_id=...
action=DOCUMENT_UPLOAD_COMPLETED
document_id=...
```

instead of free-text medical descriptions.

## 38. Implementation priority

### Phase 1 — core records and doctor workflow

```text
GET  /me
POST /patients/self
POST /doctors/self
POST /doctor/patients
POST /patient-claims
POST /patients/self/encounters
GET  /doctors/{id}/availability
POST /patients/self/appointments
POST /doctor/appointments/{id}/confirm
POST /doctor/encounters/{id}/prescription-drafts
POST /doctor/prescription-drafts/{id}/finalize
GET  /patients/self/prescriptions/{id}
GET  /patients/self/timeline
GET  /patients/self/access-ledger
```

### Phase 2 — adaptive AI

```text
POST /encounters/{id}/interaction/start
POST /interactions/{id}/responses
POST /encounters/{id}/ai-analysis
GET  /ai-sessions/{id}
GET  /ai-sessions/{id}/evidence
```

### Phase 3 — documents and draft automation

```text
POST /patients/self/documents/upload-init
POST /patients/self/documents/{id}/upload-complete
POST /doctor/prescription-drafts/ocr
POST /doctor/prescription-drafts/voice
GET  /doctor/prescription-drafts
PATCH /doctor/prescription-drafts/{id}
```

### Phase 4 — privacy controls

```text
POST /patients/self/consents/preview
POST /patients/self/consents
POST /patients/self/consents/{id}/revoke
POST /patients/self/record-removal-requests
```

## 39. End-to-end integration tests

### Test A — doctor-first record

```text
Doctor signup
   ↓
Doctor creates unclaimed patient
   ↓
Appointment created
   ↓
Encounter created
   ↓
Direct digital prescription draft
   ↓
Doctor finalizes
   ↓
Patient claims record
   ↓
Patient sees prescription
   ↓
Access ledger reflects activity
```

### Test B — AI-assisted concern

```text
Patient creates encounter
   ↓
Adaptive questions
   ↓
AI analysis
   ↓
Patient reviews evidence-based result
   ↓
Patient grants scoped consent
   ↓
Books regular doctor
   ↓
Doctor opens authorized workspace
```

### Test C — OCR/voice draft

```text
Doctor uploads paper prescription OR records voice
   ↓
Background extraction
   ↓
Draft queue
   ↓
Doctor corrects
   ↓
Doctor finalizes
   ↓
Patient sees final prescription
```

## 40. Next artifact

The next engineering artifact should be an **MVP Implementation Plan / Sprint Breakdown** that maps these endpoints and tables to a four-person team, with dependencies, definition of done, test strategy, synthetic demo data, and explicit features to defer.
