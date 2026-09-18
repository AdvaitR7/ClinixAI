# CliniX AI — Database & Data Model Specification v0.1

> Implementation-level schema derived from `CONTEXT.md` and `ARCHITECTURE_SPEC.md`.
>
> Target prototype database: **PostgreSQL via Supabase**
>
> Design goal: one longitudinal patient record shared across patient and doctor workflows, while preserving patient-controlled vault data, doctor-owned professional records, provenance, consent, auditability, and strict separation between factual clinical records and AI-derived output.

---

# 1. Core design principles

## 1.1 One patient timeline, multiple record authorities

CliniX should not treat every row as equally authoritative.

Every clinically meaningful record belongs to one of these categories:

### Patient-asserted
Examples:
- "I have had cough for 3 days."
- "I take this medicine."
- uploaded report supplied by patient.

### Doctor-authored
Examples:
- consultation note,
- finalized prescription,
- doctor-entered diagnosis,
- doctor-entered follow-up.

### Source-document-derived
Examples:
- lab value extracted from a report,
- medicine extracted from a prescription.

These records remain linked to the original document.

### AI-derived
Examples:
- historical similarity,
- suggested relevance,
- generated summary,
- missing-information analysis.

AI-derived data must never silently become an authoritative clinical fact.

---

# 2. Identity separation

Patient identity should be separated from general health data.

Conceptually:

```text
AUTH / IDENTITY
      │
      └── patient_id
             │
             ▼
        HEALTH RECORD
```

The `patients` table acts as the stable internal patient entity.

Directly identifying fields are kept in `patient_identity`.

---

# 3. Suggested PostgreSQL enums

These may be implemented as native PostgreSQL enums or constrained text columns.

```text
user_role
---------
PATIENT
DOCTOR
CLINIC_STAFF
ADMIN


patient_status
--------------
UNCLAIMED
ACTIVE
DEACTIVATED
DELETED


doctor_verification_status
--------------------------
UNVERIFIED
PENDING
VERIFIED
REJECTED
SUSPENDED


encounter_type
--------------
AI_SELF_CARE
DOCTOR_ONLINE
DOCTOR_IN_PERSON
FOLLOW_UP
RECORD_IMPORT


encounter_status
----------------
OPEN
WAITING_FOR_PATIENT
WAITING_FOR_DOCTOR
COMPLETED
CANCELLED
ESCALATED


appointment_type
----------------
ONLINE
IN_PERSON


appointment_status
------------------
REQUESTED
CONFIRMED
COMPLETED
CANCELLED
NO_SHOW


payment_status
--------------
UNPAID
REQUESTED
PAID
WAIVED
REFUNDED


document_type
-------------
LAB_REPORT
PRESCRIPTION
IMAGING_REPORT
DISCHARGE_SUMMARY
CONSULTATION_NOTE
OTHER


document_processing_status
--------------------------
UPLOADED
PROCESSING
NEEDS_REVIEW
COMPLETE
FAILED


provenance_origin
-----------------
PATIENT_ENTERED
DOCTOR_ENTERED
CLINIC_STAFF_ENTERED
OCR_EXTRACTED
VOICE_EXTRACTED
IMPORTED
AI_DERIVED
SYSTEM_GENERATED


authority_level
---------------
DRAFT
PATIENT_ASSERTED
SOURCE_DOCUMENT
DOCTOR_CONFIRMED
DOCTOR_AUTHORED
AI_DERIVED


prescription_draft_source
-------------------------
DIRECT_ENTRY
OCR
VOICE


prescription_draft_status
-------------------------
DRAFT
NEEDS_REVIEW
APPROVED
REJECTED
EXPIRED


prescription_status
-------------------
ACTIVE
SUPERSEDED
CANCELLED


consent_status
--------------
ACTIVE
REVOKED
EXPIRED


actor_type
----------
PATIENT
DOCTOR
CLINIC_STAFF
ADMIN
AI_SERVICE
SYSTEM


ai_role
-------
ANALYST_1
ANALYST_2
JUDGE
OUTPUT_COMPOSER


ai_run_status
-------------
QUEUED
RUNNING
SUCCEEDED
FAILED
BLOCKED


relationship_type
-----------------
PRIMARY_PHYSICIAN
DERMATOLOGIST
CARDIOLOGIST
DENTIST
PSYCHIATRIST
OTHER
```

---

# 4. Authentication and profiles

Clerk manages session/login. Postgres stores application roles and profiles.

Clerk's user ID (`clerk_user_id`) links a Clerk identity to a `profiles` row.
The Fastify API verifies the Clerk session token and derives role/patient/doctor IDs
from Postgres — never from client-supplied claims.

A `user.created` Clerk webhook creates the corresponding `profiles` row on signup.
Unclaimed patients (doctor-created) have no `profiles` row until claimed.

## 4.1 `profiles`

Common application-level account metadata.

```text
profiles
--------
id uuid PK
clerk_user_id text UNIQUE nullable
primary_role user_role
display_name text
avatar_url text nullable
created_at timestamptz
updated_at timestamptz
```

`clerk_user_id = NULL` means the profile row was created internally before a
Clerk identity was linked (e.g. during record claim); it should be linked at claim time.

Do not put full medical data here.

---

# 5. Patient identity

## 5.1 `patients`

Stable internal patient entity.

A patient may exist before they create a CliniX account.

```text
patients
--------
id uuid PK
account_profile_id uuid nullable FK -> profiles.id
status patient_status
claimed_at timestamptz nullable
created_by_actor_type actor_type
created_by_actor_id uuid nullable
created_at timestamptz
updated_at timestamptz
```

Important:

```text
account_profile_id = NULL
```

means the patient may have been created by a doctor/clinic and is not yet claimed by the patient.

## 5.2 `patient_identity`

Directly identifying information.

```text
patient_identity
----------------
patient_id uuid PK FK -> patients.id
full_name_encrypted bytea
phone_encrypted bytea
phone_hash text nullable
email_encrypted bytea nullable
email_hash text nullable
date_of_birth_encrypted bytea nullable
sex_at_registration text nullable
address_encrypted bytea nullable
emergency_contact_encrypted bytea nullable
created_at timestamptz
updated_at timestamptz
```

`phone_hash` / `email_hash` may be deterministic keyed hashes used only for safe duplicate detection and lookup.

Do not store plaintext phone/email merely for convenience in the health schema.

---

# 6. Doctors

## 6.1 `doctors`

```text
doctors
-------
id uuid PK
profile_id uuid UNIQUE FK -> profiles.id
registration_number text
registration_authority text
qualification text nullable
speciality text nullable
verification_status doctor_verification_status
verified_at timestamptz nullable
created_at timestamptz
updated_at timestamptz
```

A future credential-verification module can attach evidence to this table.

---

# 7. Practices / clinics

Useful for Doctor OS without requiring a hospital-grade tenant model.

## 7.1 `practices`

```text
practices
---------
id uuid PK
name text
phone text nullable
address text nullable
created_by_doctor_id uuid nullable FK -> doctors.id
created_at timestamptz
updated_at timestamptz
```

## 7.2 `practice_members`

```text
practice_members
----------------
id uuid PK
practice_id uuid FK -> practices.id
profile_id uuid FK -> profiles.id
role text
status text
created_at timestamptz
```

Roles may include:

```text
OWNER
DOCTOR
RECEPTION
ASSISTANT
```

---

# 8. Patient-doctor relationships

## 8.1 `patient_doctor_relationships`

```text
patient_doctor_relationships
----------------------------
id uuid PK
patient_id uuid FK -> patients.id
doctor_id uuid FK -> doctors.id
relationship_type relationship_type
is_preferred boolean default false
status text
started_at timestamptz
ended_at timestamptz nullable
created_at timestamptz
```

Suggested unique constraint:

```text
UNIQUE(patient_id, doctor_id, relationship_type, status)
```

Application logic should prevent more than one preferred primary physician if desired.

---

# 9. Record claim / unregistered patient workflow

## 9.1 `patient_claim_invites`

```text
patient_claim_invites
---------------------
id uuid PK
patient_id uuid FK -> patients.id
phone_hash text
invite_token_hash text UNIQUE
created_by_profile_id uuid FK -> profiles.id
expires_at timestamptz
used_at timestamptz nullable
status text
created_at timestamptz
```

Never store the raw claim token.

## 9.2 `patient_claim_events`

```text
patient_claim_events
--------------------
id uuid PK
patient_id uuid FK -> patients.id
profile_id uuid FK -> profiles.id
invite_id uuid nullable FK -> patient_claim_invites.id
event_type text
success boolean
metadata jsonb
created_at timestamptz
```

---

# 10. Provenance

A central provenance object makes it possible to trace where a clinical datum came from.

## 10.1 `provenance_records`

```text
provenance_records
------------------
id uuid PK
origin provenance_origin
authority authority_level

created_by_actor_type actor_type
created_by_actor_id uuid nullable

source_document_id uuid nullable
source_page integer nullable
source_region jsonb nullable

extraction_confidence numeric nullable

confirmed_by_doctor_id uuid nullable FK -> doctors.id
confirmed_at timestamptz nullable

notes text nullable

created_at timestamptz
```

Examples:

```text
Patient typed symptom
origin = PATIENT_ENTERED
authority = PATIENT_ASSERTED

OCR found glucose result
origin = OCR_EXTRACTED
authority = SOURCE_DOCUMENT

Doctor approves OCR prescription draft
origin = OCR_EXTRACTED
authority = DOCTOR_CONFIRMED

AI says old encounter may be similar
origin = AI_DERIVED
authority = AI_DERIVED
```

---

# 11. Encounters

`encounters` are the central clinical unit.

## 11.1 `encounters`

```text
encounters
----------
id uuid PK
patient_id uuid FK -> patients.id

encounter_type encounter_type
status encounter_status

chief_concern text nullable

initiated_by_actor_type actor_type
initiated_by_actor_id uuid nullable

related_doctor_id uuid nullable FK -> doctors.id
related_practice_id uuid nullable FK -> practices.id

parent_encounter_id uuid nullable FK -> encounters.id

started_at timestamptz
closed_at timestamptz nullable

created_at timestamptz
updated_at timestamptz
```

`parent_encounter_id` can connect a follow-up to an earlier encounter.

---

# 12. Adaptive patient questioning

## 12.1 `interaction_sessions`

```text
interaction_sessions
--------------------
id uuid PK
encounter_id uuid FK -> encounters.id
status text
current_step integer
started_at timestamptz
completed_at timestamptz nullable
```

## 12.2 `interaction_blocks`

Stores rendered AI/UI question blocks.

```text
interaction_blocks
------------------
id uuid PK
interaction_session_id uuid FK -> interaction_sessions.id
sequence_number integer
block_type text
title text
help_text text nullable
options jsonb nullable
allow_free_text boolean
generated_by_ai_session_id uuid nullable
created_at timestamptz
```

## 12.3 `interaction_responses`

```text
interaction_responses
---------------------
id uuid PK
interaction_block_id uuid FK -> interaction_blocks.id
patient_id uuid FK -> patients.id
selected_option_ids jsonb nullable
free_text text nullable
numeric_value numeric nullable
date_value date nullable
created_at timestamptz
```

Do not rely on this table alone as the health record.

Important answers should also be normalized into symptoms / observations where appropriate.

---

# 13. Symptoms

## 13.1 `symptom_entries`

```text
symptom_entries
---------------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid FK -> encounters.id

symptom_code text nullable
symptom_name text

onset_at timestamptz nullable
duration_text text nullable
severity text nullable
status text nullable

attributes jsonb

provenance_id uuid FK -> provenance_records.id

created_at timestamptz
updated_at timestamptz
```

`attributes` may temporarily carry structured symptom-specific properties before a richer ontology is introduced.

---

# 14. Conditions

## 14.1 `conditions`

```text
conditions
----------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid nullable FK -> encounters.id

condition_code text nullable
condition_name text

clinical_status text
onset_date date nullable
resolved_date date nullable

asserted_by_doctor_id uuid nullable FK -> doctors.id
provenance_id uuid FK -> provenance_records.id

created_at timestamptz
updated_at timestamptz
```

Patient-reported conditions and doctor-confirmed conditions remain distinguishable through provenance.

---

# 15. Allergies

## 15.1 `allergies`

```text
allergies
---------
id uuid PK
patient_id uuid FK -> patients.id

substance_name text
substance_code text nullable

reaction text nullable
severity text nullable
status text

provenance_id uuid FK -> provenance_records.id

created_at timestamptz
updated_at timestamptz
```

Allergies should be included in most medication-related Evidence Bundles.

---

# 16. Documents

## 16.1 `documents`

Metadata only; the binary lives in private object storage.

```text
documents
---------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid nullable FK -> encounters.id

document_type document_type

storage_bucket text
storage_object_key text

original_filename text
mime_type text
file_size_bytes bigint
sha256 text

uploaded_by_actor_type actor_type
uploaded_by_actor_id uuid nullable

processing_status document_processing_status

created_at timestamptz
deleted_at timestamptz nullable
```

Never store public object URLs.

## 16.2 `document_extractions`

```text
document_extractions
--------------------
id uuid PK
document_id uuid FK -> documents.id

extractor_type text
extractor_version text nullable

raw_text text nullable
structured_payload jsonb nullable

confidence numeric nullable
status text

created_at timestamptz
reviewed_at timestamptz nullable
reviewed_by_profile_id uuid nullable FK -> profiles.id
```

---

# 17. Laboratory reports

## 17.1 `lab_reports`

```text
lab_reports
-----------
id uuid PK
patient_id uuid FK -> patients.id
document_id uuid FK -> documents.id
encounter_id uuid nullable FK -> encounters.id

laboratory_name text nullable
collection_date date nullable
report_date date nullable

provenance_id uuid FK -> provenance_records.id

created_at timestamptz
```

## 17.2 `lab_observations`

```text
lab_observations
----------------
id uuid PK
lab_report_id uuid FK -> lab_reports.id
patient_id uuid FK -> patients.id

test_code text nullable
test_name text

value_numeric numeric nullable
value_text text nullable
unit text nullable

reference_low numeric nullable
reference_high numeric nullable
reference_text text nullable

flag text nullable

observed_at timestamptz nullable

provenance_id uuid FK -> provenance_records.id

created_at timestamptz
```

Indexes:

```text
(patient_id, test_name, observed_at DESC)
(patient_id, test_code, observed_at DESC)
```

This supports longitudinal trend charts.

---

# 18. Prescription drafts

All three input modes can produce drafts.

## 18.1 `prescription_drafts`

```text
prescription_drafts
-------------------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid nullable FK -> encounters.id
doctor_id uuid FK -> doctors.id

source prescription_draft_source
status prescription_draft_status

source_document_id uuid nullable FK -> documents.id
source_audio_document_id uuid nullable FK -> documents.id

raw_transcript text nullable
raw_extraction jsonb nullable

overall_confidence numeric nullable
risk_flags jsonb nullable

created_at timestamptz
updated_at timestamptz
reviewed_at timestamptz nullable
```

## 18.2 `prescription_draft_items`

```text
prescription_draft_items
------------------------
id uuid PK
draft_id uuid FK -> prescription_drafts.id

sequence_number integer

medicine_name text
strength text nullable
dose text nullable
route text nullable
frequency text nullable
timing text nullable
duration text nullable
instructions text nullable

field_confidence jsonb nullable
needs_review boolean default true

created_at timestamptz
updated_at timestamptz
```

Mode B and Mode C use the same review queue after extraction.

---

# 19. Final prescriptions

A logical prescription record may have multiple immutable versions.

## 19.1 `prescriptions`

```text
prescriptions
-------------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid FK -> encounters.id
doctor_id uuid FK -> doctors.id

status prescription_status

current_version_id uuid nullable

created_from_draft_id uuid nullable FK -> prescription_drafts.id

created_at timestamptz
updated_at timestamptz
```

`current_version_id` should reference `prescription_versions.id`.
Because of the circular reference, add this FK after table creation in migrations.

## 19.2 `prescription_versions`

```text
prescription_versions
---------------------
id uuid PK
prescription_id uuid FK -> prescriptions.id

version_number integer

amendment_reason text nullable

finalized_by_doctor_id uuid FK -> doctors.id
finalized_at timestamptz

supersedes_version_id uuid nullable FK -> prescription_versions.id

content_hash text

created_at timestamptz
```

Constraint:

```text
UNIQUE(prescription_id, version_number)
```

## 19.3 `prescription_items`

```text
prescription_items
------------------
id uuid PK
prescription_version_id uuid FK -> prescription_versions.id

sequence_number integer

medicine_name text
medicine_code text nullable

strength text nullable
dose text nullable
route text nullable
frequency text nullable
timing text nullable
duration text nullable
instructions text nullable

created_at timestamptz
```

A finalized version must never be updated in place.

Amendments create a new version.

---

# 20. Medication history

`medication_records` represent medication exposure/history, not merely prescriptions.

## 20.1 `medication_records`

```text
medication_records
------------------
id uuid PK
patient_id uuid FK -> patients.id

encounter_id uuid nullable FK -> encounters.id
prescription_id uuid nullable FK -> prescriptions.id
prescription_item_id uuid nullable FK -> prescription_items.id

medicine_name text
medicine_code text nullable

dose text nullable
route text nullable
frequency text nullable

started_on date nullable
ended_on date nullable

reason_for_use text nullable
response text nullable
adverse_reaction text nullable
reason_stopped text nullable

status text

provenance_id uuid FK -> provenance_records.id

created_at timestamptz
updated_at timestamptz
```

This table answers:

> What has this patient actually been recorded as taking?

while `prescriptions` answers:

> What did the doctor prescribe?

---

# 21. Doctor notes

## 21.1 `consultation_notes`

Doctor-authored professional records.

```text
consultation_notes
------------------
id uuid PK
patient_id uuid FK -> patients.id
encounter_id uuid FK -> encounters.id
doctor_id uuid FK -> doctors.id

note_type text
content text

is_final boolean default false
finalized_at timestamptz nullable

created_at timestamptz
updated_at timestamptz
```

Once finalized, edits should create a revision rather than silently overwrite.

For MVP, revisioning may be implemented through a `consultation_note_versions` table if time permits.

---

# 22. Appointments

## 22.1 `appointments`

```text
appointments
------------
id uuid PK

patient_id uuid FK -> patients.id
doctor_id uuid FK -> doctors.id
practice_id uuid nullable FK -> practices.id

encounter_id uuid nullable FK -> encounters.id

appointment_type appointment_type
status appointment_status

scheduled_start timestamptz
scheduled_end timestamptz nullable

reason text nullable

meeting_provider text nullable
meeting_reference text nullable

payment_status payment_status

requested_at timestamptz
confirmed_at timestamptz nullable
completed_at timestamptz nullable
cancelled_at timestamptz nullable

created_at timestamptz
updated_at timestamptz
```

Indexes:

```text
(doctor_id, scheduled_start)
(patient_id, scheduled_start)
(status, scheduled_start)
```

---

# 23. Manual payment events

The MVP does not process payments.

## 23.1 `payment_events`

```text
payment_events
--------------
id uuid PK
appointment_id uuid FK -> appointments.id

old_status payment_status nullable
new_status payment_status

marked_by_profile_id uuid FK -> profiles.id

reference_note text nullable

created_at timestamptz
```

This provides an audit trail even though payment itself happens outside CliniX.

---

# 24. Follow-ups

## 24.1 `followups`

```text
followups
---------
id uuid PK
patient_id uuid FK -> patients.id
doctor_id uuid nullable FK -> doctors.id
source_encounter_id uuid FK -> encounters.id

due_at timestamptz
reason text
status text

created_at timestamptz
completed_at timestamptz nullable
```

---

# 25. Consent

Consent should not be represented as a single boolean.

## 25.1 `consents`

```text
consents
--------
id uuid PK
patient_id uuid FK -> patients.id

grantee_type actor_type
grantee_id uuid

purpose text

status consent_status

starts_at timestamptz
expires_at timestamptz nullable
revoked_at timestamptz nullable

created_at timestamptz
updated_at timestamptz
```

## 25.2 `consent_scopes`

```text
consent_scopes
--------------
id uuid PK
consent_id uuid FK -> consents.id

resource_type text

resource_id uuid nullable
resource_filter jsonb nullable

permission text

created_at timestamptz
```

Examples:

```text
resource_type = ALLERGY
permission = READ

resource_type = ENCOUNTER
resource_id = E100
permission = READ

resource_type = LAB_REPORT
resource_filter = {"tag": "respiratory_relevant"}
permission = READ
```

For MVP, prefer explicit resource IDs where possible.
Avoid overly complex policy expressions initially.

---

# 26. Access ledger

Append-only.

## 26.1 `access_events`

```text
access_events
-------------
id uuid PK

patient_id uuid FK -> patients.id

actor_type actor_type
actor_id uuid nullable

purpose text

resource_type text
resource_id uuid nullable

action text

consent_id uuid nullable FK -> consents.id

request_id text nullable
ip_hash text nullable

metadata jsonb nullable

created_at timestamptz
```

Example actions:

```text
VIEW
CREATE
UPDATE
EXPORT
SHARE
AI_PROCESS
DOWNLOAD
PRINT
REVOKE_ACCESS
```

Recommended:

- application roles may INSERT,
- normal users may not UPDATE/DELETE ledger rows,
- use retention/archive policy rather than mutation.

---

# 27. Record-removal / deletion requests

## 27.1 `record_removal_requests`

```text
record_removal_requests
-----------------------
id uuid PK

patient_id uuid FK -> patients.id

target_actor_type actor_type
target_actor_id uuid nullable

resource_type text
resource_id uuid nullable

reason text nullable

status text

requested_at timestamptz
resolved_at timestamptz nullable

resolution_note text nullable
resolved_by_profile_id uuid nullable FK -> profiles.id
```

This supports:

- patient asks CliniX to delete patient-controlled data,
- patient asks doctor to remove doctor-side record,
- request may be denied/partially fulfilled where retention obligations apply.

---

# 28. AI sessions

AI state must be separate from clinical facts.

## 28.1 `ai_sessions`

```text
ai_sessions
-----------
id uuid PK

patient_id uuid FK -> patients.id
encounter_id uuid FK -> encounters.id

purpose text

status ai_run_status

started_at timestamptz
completed_at timestamptz nullable

created_at timestamptz
```

## 28.2 `ai_evidence_bundles`

The exact data presented to the analysts.

```text
ai_evidence_bundles
-------------------
id uuid PK
ai_session_id uuid FK -> ai_sessions.id

bundle_version integer
payload jsonb

payload_hash text

contains_direct_identifiers boolean default false

created_at timestamptz
```

A bundle should normally have:

```text
contains_direct_identifiers = false
```

## 28.3 `ai_model_runs`

One row per Analyst/Judge model call.

```text
ai_model_runs
-------------
id uuid PK
ai_session_id uuid FK -> ai_sessions.id

role ai_role

provider_route text
model_name text

input_hash text
output_payload jsonb nullable
output_hash text nullable

status ai_run_status

started_at timestamptz
completed_at timestamptz nullable

error_code text nullable
created_at timestamptz
```

Production should avoid retaining unnecessary raw prompts.

## 28.4 `ai_judgments`

```text
ai_judgments
------------
id uuid PK
ai_session_id uuid UNIQUE FK -> ai_sessions.id

agreements jsonb
material_disagreements jsonb
unsupported_claims jsonb
questions_to_ask_next jsonb
safe_consensus jsonb

requires_doctor_review boolean
requires_urgent_escalation boolean

created_at timestamptz
```

---

# 29. AI-derived historical matches

Do not mix these into encounter facts.

## 29.1 `ai_historical_matches`

```text
ai_historical_matches
---------------------
id uuid PK
ai_session_id uuid FK -> ai_sessions.id

current_encounter_id uuid FK -> encounters.id
historical_encounter_id uuid FK -> encounters.id

similarity_label text
similarity_score numeric nullable

supporting_features jsonb
differences jsonb

created_at timestamptz
```

Possible labels:

```text
STRONGLY_SIMILAR
PARTIALLY_SIMILAR
INSUFFICIENTLY_SIMILAR
```

This table is derived and non-authoritative.

---

# 30. Semantic retrieval

## 30.1 `semantic_chunks`

```text
semantic_chunks
---------------
id uuid PK

patient_id uuid FK -> patients.id

source_type text
source_id uuid

chunk_text text
embedding vector(<dimension>)

metadata jsonb

created_at timestamptz
```

Examples of `source_type`:

```text
CONSULTATION_NOTE
DOCUMENT_TEXT
ENCOUNTER_SUMMARY
REPORT_TEXT
```

Important:

Do not embed unnecessary direct identifiers.

Indexes:

```text
HNSW or IVFFlat vector index
(patient_id)
(source_type)
```

Queries must always include `patient_id` filtering before/with semantic retrieval.

---

# 31. Safety evaluation

## 31.1 `safety_evaluations`

```text
safety_evaluations
------------------
id uuid PK

encounter_id uuid FK -> encounters.id
ai_session_id uuid nullable FK -> ai_sessions.id

stage text

triggered_rule_ids jsonb
severity text
action text

input_hash text

created_at timestamptz
```

Examples:

```text
stage = PRE_AI
stage = POST_JUDGE
```

Actions might include:

```text
ALLOW
ASK_MORE
BLOCK_NORMAL_FLOW
DOCTOR_REVIEW
URGENT_ESCALATION
```

---

# 32. Notifications

## 32.1 `notifications`

```text
notifications
-------------
id uuid PK

recipient_profile_id uuid FK -> profiles.id

type text
title text
body text

related_resource_type text nullable
related_resource_id uuid nullable

read_at timestamptz nullable
created_at timestamptz
```

MVP can be in-app only.

---

# 33. Record authority summary

| Data | Primary authority |
|---|---|
| Patient-entered symptom | Patient-asserted |
| Uploaded lab PDF | Source document |
| OCR lab value | Derived from source; verified by source |
| Doctor diagnosis/note | Doctor-authored |
| OCR prescription draft | Draft only |
| Voice prescription draft | Draft only |
| Finalized prescription | Doctor-authored |
| AI summary | AI-derived |
| AI historical similarity | AI-derived |
| Access ledger | System/audit |
| Payment status | Operational/admin |
| Consent | Patient authorization record |

---

# 34. What is authoritative vs derived?

## Authoritative/source-oriented

- original uploaded documents,
- finalized doctor prescription versions,
- finalized doctor consultation notes,
- confirmed patient identity,
- doctor-confirmed structured observations,
- patient-authored entries as statements made by the patient.

## Derived

- OCR text,
- OCR candidate medication items,
- embeddings,
- AI summaries,
- similarity scores,
- AI-generated consultation preparation,
- judge output,
- trends generated from source observations.

Derived records must retain links to their sources.

---

# 35. Recommended foreign-key chain for a prescription

```text
patients
   │
   ▼
encounters
   │
   ├──────────────► appointments
   │
   ▼
prescription_drafts
   │
   ▼
prescriptions
   │
   ▼
prescription_versions
   │
   ▼
prescription_items
   │
   ▼
medication_records
```

Original OCR image:

```text
documents
   │
   └──► prescription_drafts.source_document_id
```

---

# 36. Recommended patient timeline query

The timeline should not come from one giant table.

Create a database view or backend aggregation layer that merges:

- encounters,
- appointments,
- finalized prescriptions,
- lab reports,
- important lab observations,
- uploaded documents,
- follow-ups.

Example normalized timeline item:

```json
{
  "type": "PRESCRIPTION",
  "occurred_at": "2026-09-16T12:00:00Z",
  "resource_id": "...",
  "title": "Prescription from Dr. Sharma",
  "encounter_id": "..."
}
```

Do not include every AI internal event on the clinical timeline.

---

# 37. Row-Level Security direction

Supabase RLS should enforce broad ownership boundaries.

## Patient rules

Patient may:
- read their own patient-controlled vault records,
- read doctor-authored records shared with them,
- create patient-authored data,
- grant/revoke applicable consent,
- view their access ledger.

Patient must not:
- alter finalized doctor prescriptions,
- alter finalized doctor notes,
- alter audit records,
- alter doctor-owned professional records.

## Doctor rules

Doctor may:
- read own professional records,
- read patient data covered by valid authorization/relationship/encounter policy,
- create consultation notes/prescriptions for patients they are treating,
- approve/reject own prescription drafts,
- access patients created in their practice as permitted.

Doctor must not:
- see unrelated patient vault data,
- silently modify another doctor's finalized record,
- mutate audit events.

## Clinic staff rules

Clinic staff may access only operational data allowed by practice role:
- appointment scheduling,
- contact/identity needed for operations,
- payment status.

They should not automatically receive full clinical access.

---

# 38. Authorization beyond RLS

RLS alone is not enough for fine-grained consent.

Recommended model:

```text
Supabase RLS
    +
Fastify authorization service
    +
consents / consent_scopes
    +
doctor relationship / appointment context
```

Every sensitive backend request should evaluate:

```text
Who is asking?
What resource?
For which patient?
For what purpose?
Is there an active consent/policy basis?
Does the actor's role allow this action?
```

Then log the access event.

---

# 39. Audit invariants

These should become engineering rules:

1. `access_events` are append-only.
2. Finalized prescription versions are immutable.
3. AI results never overwrite clinical facts.
4. OCR/voice drafts never become final without doctor approval.
5. Patient identity is not copied unnecessarily into AI payloads.
6. Every doctor access to patient vault data should be attributable.
7. Every finalized clinical record has provenance.
8. Every extracted value retains a source-document relationship where applicable.

---

# 40. Deletion strategy

Use soft deletion for records requiring retention/history.

Possible fields:

```text
deleted_at
deleted_by
deletion_reason
```

Hard deletion should be restricted to records where policy allows it.

The access ledger should preserve evidence that a deletion occurred without retaining deleted medical content unnecessarily.

---

# 41. Useful indexes

At minimum:

```text
patients(account_profile_id)

patient_doctor_relationships(patient_id, doctor_id)

encounters(patient_id, started_at DESC)
encounters(related_doctor_id, started_at DESC)

appointments(doctor_id, scheduled_start)
appointments(patient_id, scheduled_start)

documents(patient_id, created_at DESC)

lab_observations(patient_id, test_name, observed_at DESC)

prescriptions(patient_id, created_at DESC)
prescription_versions(prescription_id, version_number)

medication_records(patient_id, status)

consents(patient_id, status)
consents(grantee_type, grantee_id, status)

access_events(patient_id, created_at DESC)
access_events(actor_type, actor_id, created_at DESC)

ai_sessions(patient_id, encounter_id)
ai_model_runs(ai_session_id, role)

semantic_chunks(patient_id, source_type)
```

---

# 42. Tables to build first

Do not create every table before the application has one working flow.

## Phase 1

```text
profiles
patients
patient_identity
doctors
patient_doctor_relationships

encounters

appointments

documents
provenance_records

prescription_drafts
prescription_draft_items
prescriptions
prescription_versions
prescription_items

access_events
```

This supports the core patient ↔ doctor workflow.

## Phase 2

```text
symptom_entries
conditions
allergies
medication_records

lab_reports
lab_observations

interaction_sessions
interaction_blocks
interaction_responses

consents
consent_scopes
```

## Phase 3

```text
ai_sessions
ai_evidence_bundles
ai_model_runs
ai_judgments
ai_historical_matches

semantic_chunks
safety_evaluations
```

## Phase 4

```text
practices
practice_members
patient_claim_invites
patient_claim_events
payment_events
followups
notifications
record_removal_requests
```

---

# 43. First database milestone

The first schema milestone should demonstrate this complete transaction:

```text
1. Create doctor account
2. Doctor creates unclaimed patient
3. Doctor schedules in-person appointment
4. Encounter is created
5. Doctor writes direct digital prescription
6. Prescription is finalized as Version 1
7. Patient is invited by mobile
8. Patient claims record
9. Patient can see prescription
10. Access ledger shows doctor and patient accesses
```

No AI is required for this milestone.

That is intentional.

If this flow works, CliniX already has a strong health-record foundation before AI complexity is introduced.

---

# 44. Second database milestone

Add patient AI flow:

```text
1. Patient creates AI_SELF_CARE encounter
2. Structured questions are stored
3. Symptoms are normalized
4. Relevant history is retrieved
5. Evidence Bundle is stored
6. Analyst 1 / Analyst 2 outputs are stored
7. Judge output is stored
8. AI result is shown separately from factual history
9. Patient books regular doctor from same encounter
10. Doctor receives scoped record
```

---

# 45. Third database milestone

Add prescription intelligence:

```text
Paper prescription
      ↓
document
      ↓
OCR extraction
      ↓
prescription_draft
      ↓
doctor reviews later
      ↓
final prescription

Voice
      ↓
audio document
      ↓
speech-to-text
      ↓
prescription_draft
      ↓
doctor reviews later
      ↓
final prescription
```

Both converge on the same final prescription tables.

---

# 46. Recommended next artifact

After this schema specification, define the **API Contract Specification**.

That should specify concrete Fastify endpoints, request/response schemas, authorization rules, and event flow for:

- patient signup / claim,
- doctor signup,
- encounter creation,
- adaptive question interaction,
- report upload,
- appointment booking,
- consent grant,
- doctor patient lookup,
- prescription draft creation,
- OCR/voice draft review,
- prescription finalization,
- AI analysis,
- access-ledger retrieval.

