# CliniX AI — Architecture Specification v0.1

> Derived from `CONTEXT.md`. This is the first concrete implementation architecture for the prototype and the intended production direction.

## 1. Architecture goal

Build CliniX as one platform with two primary workspaces:

1. **Patient App**
2. **Doctor App**

Both use shared backend services and a shared encounter-oriented medical-data model, while preserving:

- patient-controlled vault data,
- doctor-owned professional clinical records,
- consent-scoped sharing,
- separate AI inference from factual records,
- full auditability.

---

# 2. Recommended prototype stack

## Exists today

### Frontend
- **Next.js + TypeScript** (App Router)
- Single app with role-based routing (`/app/patient`, `/app/doctor`)
- **Tailwind CSS v4**
- **shadcn/ui** for accessible interactive components
- **TanStack Query** for client/server data fetching
- **React Hook Form + Zod** for structured forms

### Backend API
- **Fastify (TypeScript)**
- Zod schemas for request/response validation
- **Drizzle ORM** for PostgreSQL access (drizzle-kit for migrations)
- OpenAI Node SDK (`openai` package) pointed at 9Router for model calls

### Database
- **Supabase PostgreSQL**
- Row-Level Security for defense-in-depth
- `pgvector` for semantic retrieval

### Authentication
- **Clerk** for login/session management only
- Application roles (patient, doctor, clinic_staff, admin) stored in Postgres
- Clerk webhook creates a `profiles` row on signup
- Unclaimed patients (doctor-created) exist before any Clerk account

### File storage
- **Supabase Storage** for prototype documents
- private buckets only
- signed URLs for temporary access

### AI gateway
- **9Router** for prototype only
- called through the OpenAI Node SDK
- pinned routes for:
  - Analyst 1
  - Analyst 2
  - Judge
- Analyst 1 and Analyst 2 use **different model families**

### OCR / document extraction
- **Gemini 2.5 Flash multimodal extraction through 9Router** (pinned route)
- structured candidates validated with Zod

For handwritten prescription demonstrations:
- treat extraction as experimental,
- always create a draft requiring doctor confirmation.

### Background jobs
- **pg-boss** (Postgres-backed queue, no Redis)

Jobs:
- OCR,
- document parsing,
- embeddings,
- report normalization,
- prescription draft extraction,
- notification generation.

pg-boss shares the existing Supabase PostgreSQL connection and keeps the Dokploy compose stack free of a Redis service.

For a very small first demo, synchronous processing is acceptable; move to jobs before larger documents/workflows.

---

# 3. High-level system

```text
                    ┌────────────────────────────┐
                    │      Next.js Web App       │
                    │   /app/patient & /app/doctor│
                    └──────────────┬─────────────┘
                                   │ HTTPS
                                   ▼
                    ┌────────────────────────────┐
                    │        CliniX API          │
                    │      Fastify (Node/TS)     │
                    └──────────────┬─────────────┘
                                   │
       ┌───────────────────────────┼────────────────────────┐
       │                           │                        │
       ▼                           ▼                        ▼
┌──────────────┐          ┌────────────────┐       ┌─────────────────┐
│ Supabase DB  │          │  File Storage  │       │ AI Orchestrator │
│ PostgreSQL   │          │  Private       │       │ Fastify module  │
│ + pgvector   │          └────────┬───────┘       └────────┬────────┘
└──────┬───────┘                   │                        │
       │                           ▼                        ▼
       │                  ┌─────────────────┐      ┌─────────────────┐
       │                  │  Worker Queue   │      │    9Router      │
       │                  │  pg-boss (PG)   │      │ OpenAI Node SDK │
       │                  └────────┬────────┘      └────────┬────────┘
       │                           │                        │
       │                           ▼                  ┌─────┼─────┐
       │                       Gemini OCR/            ▼     ▼     ▼
       │                       Whisper parser         A1    A2  Judge
       ▼
┌─────────────────────┐
│  Consent + Audit    │
│  authorization data │
│  access ledger      │
└─────────────────────┘
```

---

# 4. Repository layout

Recommended monorepo (pnpm workspaces):

```text
clinix/
├── apps/
│   └── web/                  # Next.js (patient + doctor, role-based routing)
│
├── services/
│   ├── api/                  # Fastify API
│   └── worker/               # pg-boss job processors
│
├── packages/
│   ├── ui/                   # shared UI components
│   ├── schemas/              # shared Zod schemas (API contract types)
│   └── config/
│
├── ai/
│   ├── prompts/
│   │   ├── analyst_1.md
│   │   ├── analyst_2.md
│   │   └── judge.md
│   ├── schemas/
│   ├── orchestrator/
│   └── evals/
│
├── docs/
│   ├── CONTEXT.md
│   └── ARCHITECTURE_SPEC.md
│
└── infra/
    ├── supabase/
    └── dokploy/              # compose files for the VPS
```

Patient and doctor UIs live in one Next.js app with role-based routing:

```text
/app/patient/...
/app/doctor/...
```

That is simpler than two independent frontend deployments.

---

# 5. Core backend modules

Keep one Fastify deployable service initially, but separate code by domain.

```text
api/src/
├── auth/
├── patients/
├── doctors/
├── encounters/
├── appointments/
├── prescriptions/
├── medications/
├── reports/
├── labs/
├── consent/
├── audit/
├── ai/
├── retrieval/
└── notifications/
```

This is a **modular monolith**, not microservices.

## Recommendation

Use a modular monolith for the prototype.

Why:
- easier deployment,
- simpler debugging,
- fewer network boundaries,
- easier database transactions,
- appropriate for a small team.

Do not create microservices until real scaling or organizational boundaries justify them.

---

# 6. Identity model

Use Clerk for session management, but resolve application roles and profiles from Postgres.

```text
Clerk user
    ↓ (webhook / user_id)
profiles
    ├── patient_profile
    ├── doctor_profile
    └── staff_profile
```

A person may theoretically hold multiple roles later, but MVP can restrict one primary role per account.

---

# 7. Patient data model

Core tables:

```text
patients
patient_profiles
patient_preferences
patient_doctor_relationships

encounters
symptoms
conditions
allergies

medication_records
prescriptions
prescription_items
prescription_versions

reports
report_extractions
lab_observations

appointments
consultation_notes
followups

documents
document_links

consents
consent_scopes
access_events

ai_sessions
ai_evidence_bundles
ai_analyses
ai_judgments
```

---

# 8. Patient vs doctor record ownership

Do not attempt to represent ownership with a single `owner_id`.

Use explicit provenance.

Example:

```text
prescriptions
- id
- patient_id
- doctor_id
- encounter_id
- created_by_doctor_id
- source_type
- status
- finalized_at
```

A patient's vault references the prescription.

The doctor's clinical workspace also references the same prescription record or a professional immutable copy/version.

Access and deletion are policy-driven rather than determined only by who owns the database row.

---

# 9. Encounter as the central clinical unit

Nearly everything should connect to an encounter.

```text
encounter
- id
- patient_id
- encounter_type
- initiated_by
- started_at
- closed_at
- status
- chief_concern
```

Possible types:

```text
AI_SELF_CARE
DOCTOR_ONLINE
DOCTOR_IN_PERSON
FOLLOW_UP
RECORD_IMPORT
```

Example:

```text
Patient says "I have cough"
        ↓
Encounter E100 created
        ↓
AI questions + answers linked to E100
        ↓
Relevant history linked as references
        ↓
Patient books Dr Sharma
        ↓
Appointment A220 references E100
        ↓
Doctor consultation uses E100
        ↓
Prescription P881 references E100
```

This preserves continuity.

---

# 10. Adaptive question UI

The AI should not return raw chat text as its primary interaction contract.

Define a structured `InteractionBlock`.

Example schema:

```json
{
  "block_type": "single_select",
  "title": "How long have you had the cough?",
  "help_text": null,
  "options": [
    {"id": "lt_1d", "label": "Less than 24 hours"},
    {"id": "1_3d", "label": "1–3 days"},
    {"id": "gt_3d", "label": "More than 3 days"}
  ],
  "allow_free_text": true
}
```

Supported block types can grow gradually:

```text
single_select
multi_select
yes_no
numeric_input
date
text
scale
document_upload
confirmation
warning
summary_card
```

The frontend renders these deterministically.

---

# 11. AI interaction flow

```text
Patient creates concern
        ↓
Fastify API creates encounter
        ↓
Safety pre-check
        ↓
Context Builder retrieves relevant history
        ↓
Question Planner determines missing information
        ↓
Structured InteractionBlock returned
        ↓
Patient answers
        ↓
Repeat until evidence is sufficient
        ↓
Evidence Bundle frozen/versioned
        ↓
Analyst 1 + Analyst 2 run in parallel
        ↓
Judge evaluates both
        ↓
Deterministic post-check
        ↓
Patient-safe output generated
        ↓
Optional doctor booking/review
```

---

# 12. Three-model orchestration

## Step 1 — Evidence Bundle

Canonical JSON object:

```json
{
  "encounter_id": "E100",
  "demographics": {
    "age_band": "18-30"
  },
  "current_concern": {},
  "relevant_history": [],
  "conditions": [],
  "allergies": [],
  "current_medications": [],
  "relevant_labs": [],
  "historical_prescriptions": [],
  "source_references": []
}
```

No unnecessary:
- name,
- phone,
- email,
- exact address.

## Step 2 — Analyst 1

Returns strict JSON, not unbounded prose.

Example:

```json
{
  "important_findings": [],
  "historical_matches": [],
  "missing_information": [],
  "safety_concerns": [],
  "supported_guidance": [],
  "doctor_questions": [],
  "confidence": "medium"
}
```

## Step 3 — Analyst 2

Receives the same evidence independently.

Same schema.

No Analyst 1 answer is shown initially.

## Step 4 — Judge

Receives:
- evidence,
- Analyst 1,
- Analyst 2.

Returns:

```json
{
  "agreements": [],
  "material_disagreements": [],
  "unsupported_claims": [],
  "questions_to_ask_next": [],
  "safe_consensus": [],
  "requires_doctor_review": false,
  "requires_urgent_escalation": false
}
```

## Step 5 — Output composer

A separate deterministic formatter or narrowly prompted generation step converts judge-approved content into UI blocks.

Do not let raw analyst output go directly to the patient.

---

# 13. Deterministic safety engine

Implement as code/config separate from LLM prompts.

Initial architecture:

```text
safety/
├── rules.ts
├── rule_sets/
│   ├── emergency.json
│   ├── medication.json
│   └── contraindication.json
└── evaluator.ts
```

Example conceptual rule:

```typescript
if (severeBreathlessness) {
  return BLOCK_NORMAL_FLOW;
}
```

Do not hardcode clinically sensitive rules until they are sourced/reviewed.

For the college prototype, demonstrate the framework with a small curated set of clearly documented rules.

---

# 14. History retrieval

Use two retrieval channels.

## A. SQL retrieval

Good for:
- allergies,
- current medication,
- exact lab values,
- dates,
- prescriptions,
- encounter types.

## B. Vector retrieval

Good for:
- doctor notes,
- extracted report text,
- previous symptom descriptions,
- narrative similarity.

Flow:

```text
current concern
      ↓
retrieval planner
      ├── SQL queries
      └── pgvector search
             ↓
rank/merge
             ↓
Evidence Bundle
```

The retrieval planner is backend code, not a fully autonomous agent.

---

# 15. Files and reports

## Upload flow

```text
Browser
  ↓
Signed upload URL
  ↓
Private object storage
  ↓
documents row created
  ↓
background extraction job
  ↓
OCR/parser
  ↓
candidate structured data
  ↓
validation
  ↓
user/doctor confirmation if required
```

Never expose raw private buckets publicly.

---

# 16. Lab extraction

For printed laboratory reports:

```text
PDF/image
   ↓
OCR / vision parser
   ↓
candidate observations
   ↓
normalization
   ↓
unit/reference-range validation
   ↓
review if low confidence
   ↓
lab_observations
```

Store:
- source document,
- source page,
- extracted raw text,
- normalized value,
- extraction confidence.

---

# 17. Prescription Mode A — direct digital

```text
Doctor UI
   ↓
medicine search / free entry
   ↓
structured items
   ↓
draft prescription
   ↓
doctor finalizes
   ↓
immutable prescription version
   ↓
patient timeline
   ↓
PDF / print / send
```

---

# 18. Prescription Mode B — paper + OCR

```text
Paper prescription
   ↓
photo/upload
   ↓
document job
   ↓
OCR / vision extraction
   ↓
structured draft
   ↓
risk/confidence flags
   ↓
doctor Draft Queue
   ↓
doctor edits / approves
   ↓
final prescription
```

The extracted draft is not authoritative.

---

# 19. Prescription Mode C — voice

```text
Doctor microphone
   ↓
record audio
   ↓
speech-to-text
   ↓
medication entity extraction
   ↓
structured draft
   ↓
doctor Draft Queue
   ↓
doctor edits / approves
   ↓
final prescription
```

Mode B and Mode C share the same downstream draft-review system.

---

# 20. Draft review UI

The review screen should optimize for speed.

Example:

```text
Rahul Mehta — Prescription Draft

Source: handwritten scan
Created: 6:42 PM

1. Amoxicillin
   [500] mg
   [1-0-1]
   [5] days

   OCR confidence: MEDIUM

2. Paracetamol
   [500] mg
   [SOS]

[ View original image ]

[ Approve all ]
[ Save changes ]
[ Reject draft ]
```

Keyboard shortcuts and mobile quick-actions can be added later.

---

# 21. Prescription versions

Never overwrite finalized prescriptions.

Use:

```text
prescriptions
prescription_versions
prescription_items
```

If changed:

```text
Version 1 — finalized 18:04
Version 2 — amended 18:12
Reason: dosage correction
```

Audit both.

---

# 22. Doctor dashboard

Minimum doctor MVP screens:

```text
/dashboard
/appointments
/patients
/patients/[id]
/drafts
/prescriptions
/settings
```

Dashboard widgets:

```text
Today's appointments
Pending prescription drafts
Follow-ups due
Recent patients
Incoming appointment requests
```

---

# 23. Patient dashboard

Minimum patient MVP screens:

```text
/home
/new-concern
/timeline
/reports
/medications
/doctors
/appointments
/privacy
/settings
```

Key home cards:

```text
Ask CliniX
Upcoming appointment
Recent report
My regular doctor
Health timeline
Privacy/access ledger
```

---

# 24. Doctor relationship model

Table:

```text
patient_doctor_relationships
- id
- patient_id
- doctor_id
- relationship_type
- status
- created_at
- preferred
```

Examples:
- primary physician,
- dermatologist,
- cardiologist,
- dentist,
- other.

---

# 25. Appointment flow

```text
Patient selects doctor
        ↓
Doctor availability shown
        ↓
Patient selects online/in-person
        ↓
Time selected
        ↓
Relevant encounter selected/created
        ↓
Consent scope shown
        ↓
Booking request created
        ↓
Doctor accepts/auto-accept policy later
        ↓
Payment status manual
        ↓
Appointment confirmed
```

---

# 26. Payment tracking

Prototype:

```text
payment_status =
UNPAID
REQUESTED
PAID
WAIVED
```

Doctor/staff updates manually.

No Razorpay/Stripe integration required for first MVP.

---

# 27. Consent model

Tables:

```text
consents
- id
- patient_id
- grantee_type
- grantee_id
- purpose
- starts_at
- expires_at
- revoked_at

consent_scopes
- consent_id
- resource_type
- resource_filter
- permission
```

Example:

```text
Doctor Sharma
Purpose: consultation E100

Allowed:
- current encounter
- allergies
- current medications
- respiratory history
- selected prescription

Not allowed:
- unrelated mental-wellness records
```

Backend authorization checks consent before returning protected resources.

---

# 28. Access ledger

Every sensitive access should create an event.

```text
access_events
- id
- patient_id
- actor_type
- actor_id
- purpose
- resource_type
- resource_id
- action
- timestamp
- consent_id
```

Examples:
- VIEW_REPORT
- VIEW_PRESCRIPTION
- RUN_AI_ANALYSIS
- EXPORT_RECORD
- SHARE_WITH_DOCTOR

Patient Privacy screen reads from this ledger.

---

# 29. AI access logging

Do not log the entire prompt by default.

Log metadata such as:

```text
ai_session_id
patient_id
encounter_id
model_role
provider_route
model_name
started_at
completed_at
evidence_bundle_hash
result_hash
status
```

For the prototype with synthetic data, richer logs are acceptable for debugging.

Production should minimize raw prompt retention.

---

# 30. Privacy boundary

Conceptual production flow:

```text
IDENTITY STORE
     │
     └── internal patient UUID
                │
                ▼
          HEALTH STORE
                │
                ▼
         Context Builder
                │
         minimum necessary
                ▼
         pseudonymization
                │
                ▼
         Model Gateway
                │
                ▼
        India-resident model
```

The model does not need ordinary identity fields for most analysis.

---

# 31. Prototype privacy position

Because prototype AI routes through 9Router/external models:

**Use synthetic medical data only.**

Do not use:
- real patient reports,
- classmates' private medical history,
- faculty medical data,
- real prescriptions containing private identifiers.

Create synthetic personas and synthetic PDFs for evaluation/demo.

---

# 32. Production privacy direction

Target:

- India-resident database,
- India-resident object storage,
- India-resident AI inference,
- controlled model gateway,
- restricted egress,
- encryption at rest/in transit,
- KMS/HSM-backed keys,
- pseudonymized evidence,
- no uncontrolled model fallback,
- access ledger,
- scoped consent.

This is a production target, not something the prototype should falsely claim to have fully achieved.

---

# 33. Patient deletion model

Separate:

1. patient-controlled vault data,
2. doctor-created professional records.

Patient may request:
- delete patient-only stored documents,
- revoke doctor access,
- delete account,
- request doctor-side record removal.

Doctor-side professional records may remain where retention obligations apply.

The system should record:
- request,
- affected records,
- resolution,
- reason/status.

---

# 34. Notifications

Prototype can start with in-app notifications.

Later:
- SMS,
- email,
- WhatsApp where legally/contractually suitable,
- push notifications.

Use notifications for:
- appointment confirmation,
- appointment reminder,
- prescription draft pending,
- doctor review complete,
- follow-up due,
- patient record-claim invitation.

---

# 35. Patient record claim flow

```text
Doctor creates unregistered patient
        ↓
mobile number stored
        ↓
record-claim invite
        ↓
patient creates account
        ↓
phone verification
        ↓
matching record shown
        ↓
patient confirms identity/link
        ↓
doctor record linked to patient vault
```

This needs careful duplicate/identity handling before production.

Prototype can use one-time codes and demo identities.

---

# 36. Recommended MVP slice

Do **not** implement every future feature at once.

## MVP-A — foundation

Build:
- authentication,
- patient dashboard,
- doctor dashboard,
- patient records,
- encounters,
- appointments,
- direct digital prescription,
- PDF/report upload,
- simple access ledger.

## MVP-B — AI

Add:
- adaptive question blocks,
- relevant-history retrieval,
- Evidence Bundle,
- Analyst 1,
- Analyst 2,
- Judge,
- structured output.

## MVP-C — document intelligence

Add:
- lab extraction,
- OCR prescription draft,
- draft review queue,
- voice prescription draft.

## MVP-D — privacy demonstration

Add:
- scoped doctor consent,
- access ledger UI,
- pseudonymized AI payload display for demo,
- Private Consultation Mode vs Health Vault.

---

# 37. Suggested team split

For four students:

## Student 1 — Patient frontend
- patient dashboard,
- adaptive question UI,
- timeline,
- reports,
- appointment booking.

## Student 2 — Doctor frontend
- doctor dashboard,
- patient workspace,
- appointments,
- prescription editor,
- draft queue.

## Student 3 — Backend/data
- Fastify API,
- Supabase/PostgreSQL + Drizzle,
- auth (Clerk integration),
- data model,
- consent,
- audit,
- file upload.

## Student 4 — AI/document intelligence
- 9Router integration,
- analyst/judge orchestration,
- retrieval,
- OCR,
- embeddings,
- evaluation harness.

All four should jointly define schemas/API contracts before implementation.

---

# 38. First build order

Recommended sequence:

```text
1. Database schema
2. Auth + roles
3. Patient/doctor base dashboards
4. Encounter CRUD
5. Appointment flow
6. Direct prescription flow
7. File upload
8. Access ledger
9. Adaptive AI question schema
10. Evidence Bundle builder
11. 2 analysts + judge
12. Historical retrieval
13. Lab extraction
14. OCR draft queue
15. Voice draft queue
16. Privacy-mode polish
```

This order ensures the product works before adding the hardest AI features.

---

# 39. What to test first

A realistic first end-to-end demo scenario:

## Synthetic patient

Patient has:
- one previous cough encounter,
- one old prescription,
- known allergy,
- one lab report,
- regular doctor.

## Demo

```text
Patient opens CliniX
        ↓
selects "New health concern"
        ↓
enters "I have cough again"
        ↓
adaptive UI asks structured questions
        ↓
history retrieval finds previous episode
        ↓
Evidence Bundle created
        ↓
Analyst 1 + Analyst 2 run
        ↓
Judge reconciles
        ↓
CliniX shows supported historical context
        ↓
patient chooses "Book my regular doctor"
        ↓
appointment booked
        ↓
doctor sees prepared case
        ↓
doctor writes prescription digitally
        ↓
patient timeline updates
        ↓
access ledger shows the accesses
```

This single scenario demonstrates nearly the entire product thesis.

---

# 40. Next engineering artifact

After this architecture spec, create the **database/schema specification** next.

That document should define every MVP table, primary/foreign keys, ownership/provenance fields, versioning strategy, consent relationships, and which tables are authoritative vs derived/AI-generated.
