# CliniX AI — CONTEXT

> Current source of truth for product and architecture decisions made during the design/grilling sessions.

## 1. Product identity

CliniX AI has expanded beyond the original idea of a standalone AI preventive-health assistant.

The current direction is a **privacy-first personal health record and clinical workflow platform** connecting:

- patients,
- longitudinal health records,
- AI-assisted self-care and consultation preparation,
- doctors,
- appointments,
- prescriptions,
- laboratory reports,
- consent-controlled sharing,
- and clinical workflow tools.

The AI is an intelligence layer inside the platform, not the entire product.

A concise positioning statement is:

**CliniX AI is a privacy-first personal health record and clinical workflow platform connecting patients, AI assistance, and doctors through one longitudinal medical record.**

---

## 2. MVP users and scope

### Target users
- Adults aged 18+.
- Non-emergency health and wellness use.
- Preventive and low-risk self-care support.
- Longitudinal medical-history organization.
- Pre-consultation preparation.
- Doctor booking and clinical-record workflows.

### Explicit MVP exclusions
- Pediatric care.
- Pregnancy-specific care.
- Emergency care.
- Acute critical-care diagnosis/treatment.

Emergency-risk situations may be detected only to interrupt the normal flow and direct the user toward professional/emergency help.

---

## 3. Two main patient routes

Both routes operate on the same underlying health record.

### Route A — AI-assisted patient route

The patient can:
- report a new symptom or concern,
- answer adaptive follow-up questions,
- retrieve relevant history,
- identify similar previous episodes,
- review treatment previously associated with those episodes,
- organize reports and laboratory values,
- receive preventive/low-risk self-care guidance,
- prepare for a consultation,
- see uncertainty and escalation prompts,
- request doctor review or book an appointment.

Historical medication must never be reduced to:

**same symptom = same medicine**

A previous medicine is context tied to a prior encounter, not automatic authorization to reuse it.

### Route B — Doctor / consultation route

From the same workflow, the user can:
- select a regular doctor,
- select another doctor in future,
- request doctor decision support,
- book an appointment,
- choose online or in-person mode,
- share a scoped part of the record,
- send a pre-organized consultation packet.

The doctor can:
- review the relevant timeline,
- inspect source documents,
- see factual record separately from AI assistance,
- consult the patient,
- prescribe,
- create/update encounter records,
- set follow-ups.

---

## 4. Central product asset

The **shared longitudinal health record** is the core system asset.

AI, appointments, consultations, prescriptions, reports, and follow-ups all operate on the same patient timeline.

Example:

```text
Patient symptom entry
        ↓
Encounter
        ↓
Relevant-history retrieval
        ↓
Adaptive AI questioning
        ↓
Patient books regular doctor
        ↓
Appointment references same encounter
        ↓
Doctor consultation
        ↓
Prescription / notes
        ↓
Follow-up
        ↓
Longitudinal patient record
```

---

## 5. Patient UI philosophy

CliniX should **not visually feel like a generic chatbot**.

The AI decides what needs to be asked, but the frontend renders polished structured UI components.

Typical pattern:

```text
How long have you had the cough?

[ Less than 24 hours ]

[ 1–3 days ]

[ More than 3 days ]

[ Something else... ]
```

Principles:
- Usually present 3 useful structured choices when appropriate.
- Always provide a free-text path such as **Something else...**
- Use buttons, cards, selectors, forms, timelines, and expandable panels.
- Preserve conversational flexibility without visually presenting a chat-first interface.

Possible model response:

```json
{
  "question_type": "single_select",
  "question": "How long have you had the cough?",
  "options": [
    "Less than 24 hours",
    "1–3 days",
    "More than 3 days"
  ],
  "allow_free_text": true
}
```

Next.js renders the corresponding component.

---

## 6. Personal Health Vault

CliniX should support a persistent longitudinal patient profile.

Potential entities:
- encounters,
- symptoms,
- doctor-supplied diagnoses,
- medications,
- prescriptions,
- allergies,
- conditions,
- laboratory observations,
- uploaded reports,
- lifestyle information,
- mental-wellness information,
- Ayurvedic preferences,
- appointments,
- doctor relationships,
- follow-ups.

### Two privacy modes

#### Private Consultation Mode
Persistent storage is not mandatory.

Possible flow:

```text
Enter/upload health information
        ↓
CliniX analyzes it
        ↓
Consultation package generated
        ↓
User keeps result
        ↓
Temporary data deleted according to policy
```

#### Personal Health Vault
User explicitly opts in to long-term storage.

Benefits:
- historical episode retrieval,
- medication history,
- laboratory trends,
- longitudinal personalization,
- regular-doctor continuity,
- consultation preparation.

---

## 7. Patient-controlled vault vs doctor-owned records

The patient's longitudinal CliniX vault is patient-controlled.

Doctors receive scoped access based on authorization and clinical context.

However, doctors retain their own professional clinical records for care they provided.

### Prescription ownership decision

A prescription created/finalized by a doctor remains part of the doctor's professional record.

If the patient stops using CliniX or leaves that doctor:
- the doctor's copy remains with the doctor,
- the patient can request removal/deletion,
- removal is not automatic,
- the doctor decides subject to applicable professional/legal retention obligations.

CliniX must not promise deletion of a record the doctor is independently required or entitled to retain.

---

## 8. Doctors can use CliniX before patients register

A doctor should be able to create a record for a patient who does not yet have a CliniX account.

Flow:

```text
Doctor creates clinic patient
        ↓
Doctor maintains local clinical record
        ↓
Appointments / notes / prescription stored
        ↓
Invitation sent to patient's mobile number
        ↓
Patient can later claim/link their CliniX record
```

A professional copy remains in the doctor's record.

This avoids making patient signup a prerequisite for doctor adoption.

---

## 9. Doctor value proposition

Doctors should not join merely to approve AI output.

CliniX should act as a **Doctor Operating System / clinical workspace / practice-management layer**.

Potential value:
- appointment calendar,
- online and in-person scheduling,
- patient lists,
- longitudinal history,
- pre-consultation summaries,
- relevant lab trends,
- prescription management,
- consultation notes,
- follow-up management,
- document storage,
- incoming consultation requests,
- pending-draft queues,
- AI-assisted record organization,
- quick access to previous encounters,
- structured medication history.

The doctor receives better-prepared patients and reduced administrative overhead.

---

## 10. Appointments

Appointments support:

```text
type = ONLINE | IN_PERSON
```

Shared data may include:

```text
appointment_id
patient_id
doctor_id
encounter_id
date_time
type
reason
status
payment_status
consultation_status
```

For online mode, a meeting/video layer can be added.

For in-person mode, facility/clinic details are attached.

---

## 11. Payments

Initial CliniX does **not** need a payment gateway.

Payments remain manually controlled by the doctor.

Possible states:
- unpaid,
- payment requested,
- paid,
- waived,
- adjusted/refunded in future.

For online appointments:
- advance payment is recommended,
- but the doctor's policy decides.

Doctor/staff manually marks payment status in the initial implementation.

---

## 12. Doctor prescription workflows

CliniX must not force duplicate data entry.

### Mode A — Direct digital prescription

Doctor enters the prescription directly in CliniX.

Possible fields:
- medicine,
- dose,
- route,
- frequency,
- timing instructions,
- duration,
- notes.

Actions:
- save,
- finalize,
- print,
- send to patient.

After finalization, the prescription becomes an authoritative doctor-created record.

### Mode B — Paper prescription + OCR/vision

Doctor continues writing physically.

Flow:

```text
Doctor writes prescription
        ↓
Photo / scan captured
        ↓
OCR / vision extraction
        ↓
Structured draft created
        ↓
Saved to doctor's draft queue
        ↓
Doctor reviews later
        ↓
Fast UI corrections
        ↓
Doctor approves
        ↓
Final prescription record
```

Important:
- OCR output is **always a draft**.
- Doctor can approve during a break, after clinic, or later at night.
- UI should optimize for rapid correction/approval.
- Handwritten prescriptions are a high-risk extraction problem; confirmation is mandatory.

### Mode C — Voice dictation

Doctor can dictate:

> "Paracetamol five hundred milligrams, one tablet twice daily after food for three days."

Flow:

```text
Doctor voice
        ↓
Speech-to-text
        ↓
Structured medication extraction
        ↓
Prescription draft
        ↓
Saved to draft queue
        ↓
Doctor reviews / edits
        ↓
Doctor approves
        ↓
Final prescription
```

Voice output is also **draft-first**, never final automatically.

Possible technologies:
- Whisper (via 9Router),
- LLM structured extraction,
- Zod validation.

---

## 13. Prescription draft queue

Doctors should have a dedicated review queue.

Example:

```text
Prescription Drafts

3 need review

Rahul Mehta
OCR confidence: Medium
2 medicines detected
[ Review ]

Priya Shah
Voice draft
4 medicines
[ Review ]

Advait Raut
OCR confidence: High
1 possible dosage ambiguity
[ Review ]
```

Goal: make deferred approval fast enough that the workflow is genuinely useful.

---

## 14. Prescription printing

No specialized printer integration is required initially.

```text
Prescription data
        ↓
HTML/PDF template
        ↓
A4 prescription
        ↓
Browser print dialog
        ↓
Installed printer
```

Possible technologies:
- `@react-pdf/renderer`,
- PDFKit,
- Playwright/Puppeteer PDF generation.

Possible actions:
- Save Prescription
- Print Prescription
- Send to Patient

---

## 15. Medication data model

Medication must retain context.

Possible fields:

```text
medication_record_id
patient_id
encounter_id
prescription_id
medicine_name
dose
frequency
route
duration
prescribed_date
prescribing_doctor_id
associated_problem
reason_for_use
response
adverse_reaction
reason_stopped
source_document_id
status
```

This lets CliniX distinguish:

- "The patient once took X"
from
- "X was prescribed by Dr. Y for this specific episode."

---

## 16. Historical episode matching

For a symptom such as cough, matching uses multiple features:

- symptom type,
- duration,
- severity,
- associated symptoms,
- current conditions,
- current medicines,
- allergies,
- historical diagnosis/context,
- prior response,
- adverse reactions.

Possible classifications:
- strongly similar,
- partially similar,
- insufficiently similar.

Similarity supports retrieval/context. It does not authorize treatment.

---

## 17. AI architecture

Personalized Analysis Engine:

- **Analyst LLM 1**
- **Analyst LLM 2**
- **Judge LLM**
- deterministic safety/validation logic

### Analyst 1
Primary structured medical-context analysis.

### Analyst 2
Independent analysis. It should initially not see Analyst 1's result.

### Judge
Receives:
- the Evidence Bundle,
- Analyst 1 output,
- Analyst 2 output.

Evaluates:
- agreement,
- disagreement,
- unsupported claims,
- missing evidence,
- uncertainty,
- need for more patient questions,
- need for doctor escalation.

Three-model agreement is **not** considered proof of medical correctness.

---

## 18. AI disagreement handling

```text
Minor disagreement
→ judge resolves from evidence

Missing-information disagreement
→ ask patient another structured question

Medication/safety disagreement
→ do not force a treatment answer
→ offer doctor review

Major unresolved disagreement
→ recommend professional consultation
```

Uncertainty must increase when analysts materially disagree.

---

## 19. Deterministic safety layer

LLMs are not the sole safety mechanism.

A deterministic layer handles predefined risk rules.

Potential categories:
- severe breathlessness,
- chest pain,
- neurological red flags,
- allergic reactions,
- known medication allergies,
- interaction risks,
- relevant pregnancy uncertainty,
- dangerous symptom combinations.

Exact medical rules require clinical sourcing/validation.

When critical rules trigger, normal AI guidance stops and the user is routed toward professional/emergency care.

---

## 20. Evidence Bundle / minimum necessary context

LLMs must not automatically receive the patient's entire vault.

A context builder retrieves only what is relevant.

Example for recurring cough:

```text
current complaint
current medications
known allergies
chronic conditions
relevant respiratory history
previous similar episodes
related prescriptions
relevant recent labs
```

This becomes the **Evidence Bundle**.

Both analysts receive it independently.

The judge receives:
- Evidence Bundle,
- Analyst 1 output,
- Analyst 2 output.

---

## 21. Retrieval

Use hybrid retrieval.

### Structured retrieval
PostgreSQL for:
- symptoms,
- dates,
- medications,
- doctors,
- appointments,
- lab observations,
- diagnoses.

### Semantic retrieval
Vector search for:
- notes,
- extracted report text,
- historical descriptions,
- fuzzy encounter similarity.

Recommended prototype:
- Supabase PostgreSQL,
- pgvector.

---

## 22. Input sources

MVP supports:
- structured/manual forms,
- PDF laboratory reports,
- photographs/scans of reports,
- manual medication entry,
- uploaded prescriptions.

Important extracted information becomes structured data while source documents remain available for verification.

---

## 23. Laboratory model

Example observation:

```text
observation_id
report_id
test_name
value
unit
reference_range
collection_date
source_page
confidence
```

This enables longitudinal trends.

---

## 24. Document extraction

```text
Upload
   ↓
File storage
   ↓
OCR / document extraction
   ↓
Structured candidate data
   ↓
Validation
   ↓
Human confirmation where medically important
   ↓
Structured health record
```

Source documents remain authoritative for verification.

---

## 25. Accuracy definition

Do not claim vague overall "medical accuracy".

Evaluate components separately:
- lab extraction accuracy,
- prescription extraction accuracy,
- history retrieval accuracy,
- episode matching quality,
- summary faithfulness,
- factual grounding,
- safety-rule performance,
- medication-history matching accuracy,
- patient usefulness,
- doctor usefulness.

The MVP is a technical/usability feasibility prototype, not a clinical diagnostic-validation study.

---

## 26. Ayurveda

All four original input categories remain.

Primary:
1. symptoms and medical history,
2. laboratory reports,
3. mental wellness and lifestyle.

Secondary:
4. Ayurvedic wellness preferences.

Ayurveda may personalize:
- wellness preferences,
- lifestyle suggestions,
- yoga/activity options.

It should not in the MVP:
- override biomedical interpretation,
- independently diagnose,
- independently prescribe herbs/medicines,
- replace medical treatment.

---

## 27. Privacy is a product feature

Privacy is a core differentiator, not a footer.

The architecture should minimize unnecessary plaintext access.

---

## 28. Identity / health-data separation

Conceptual separation:

```text
IDENTITY VAULT
user_id
name
email
phone
authentication data

HEALTH VAULT
user_id
symptoms
labs
medications
reports
history
encounters
```

Link using a pseudonymous/random identifier.

AI generally does not need:
- name,
- email,
- phone.

Do not include those in model context unless strictly required.

---

## 29. Encryption

Sensitive information should be encrypted:
- in transit,
- at rest.

Possible envelope-encryption design:

```text
medical document
        ↓
unique data-encryption key
        ↓
AES-256 encryption
        ↓
encrypted object stored
        ↓
data key encrypted by KMS/HSM-managed key
```

Production should include:
- strict access control,
- pseudonymization/tokenization,
- audit logs,
- secrets management,
- key management,
- controlled network egress.

---

## 30. India data-sovereignty goal

Production should aim for:

**Identifiable patient health data and AI inference remain within India.**

This is a design goal, not a marketing claim that should be made until the actual deployment and contracts satisfy it.

---

## 31. Third-party LLM rule

Production must not indiscriminately send identifiable health information to ordinary third-party LLM APIs.

If a third-party model is used:
- minimum necessary context,
- pseudonymized evidence,
- defined processing arrangement,
- controlled region,
- no uncontrolled provider fallback,
- no patient-data training.

Under strict sovereignty mode, inference should occur within India.

---

## 32. Production AI direction

Possible direction:

```text
India-hosted GPU infrastructure
        ↓
Linux
        ↓
Docker
        ↓
vLLM
        ↓
Open-weight / approved model
        ↓
Private CliniX API
```

Alternatively, approved India-region managed inference can be used if contractual/technical controls meet requirements.

The application should call a provider-independent Model Gateway.

---

## 33. Prototype AI

Prototype uses **9Router** as the model gateway.

```text
CliniX Fastify API (TypeScript)
        ↓
9Router
        ↓
Analyst 1
Analyst 2
Judge
```

Analyst 1 and Analyst 2 must use **different model families** via 9Router routing.
The same model for both analysts would produce correlated errors and fake agreement,
which defeats the purpose of independent analysis.

Prototype safeguards:
- synthetic/fake patient data only,
- no real sensitive health records,
- pinned model/provider configuration,
- disable automatic cross-provider fallback where possible,
- disable request logging where possible,
- explicitly know which providers receive each request.

9Router is a prototype orchestration choice, not the production privacy architecture.

---

## 34. Access ledger

Patients should be able to inspect who accessed their data.

Possible fields:

```text
access_event_id
patient_id
actor_type
actor_id
resource_type
resource_id
purpose
timestamp
action
authorization_id
```

Ledger may include:
- doctor access,
- clinic staff access,
- AI-processing events,
- sharing events,
- exports,
- administrative access.

---

## 35. Consent-scoped doctor access

Doctors should not automatically see the entire vault.

Example:

```text
Share with Dr. Sharma

✓ Current complaint
✓ Allergies
✓ Current medication
✓ Relevant respiratory history
✓ March prescription

□ Mental wellness history
□ Ayurvedic preferences
□ Unrelated laboratory reports
```

Permissions may be:
- consultation-specific,
- relationship-based,
- temporary,
- revocable where appropriate.

Doctor-created professional records are distinct from temporary vault access.

---

## 36. Multiple doctors

A patient can have multiple doctors.

Possible relationship types:
- primary physician,
- dermatologist,
- cardiologist,
- dentist,
- psychiatrist,
- other.

Each relationship gets appropriately scoped access.

---

## 37. Regular-doctor relationship

Example patient flow:

```text
My Doctors

Dr. Sharma
Primary physician

[ Book appointment ]

○ Clinic visit
○ Online consultation
```

CliniX is designed to support continuity, not only random one-off consultations.

---

## 38. Doctor consultation packet

When a patient requests review/books from an AI encounter, CliniX prepares:

```text
PATIENT SUMMARY

Current complaint
Relevant timeline
Known conditions
Current medicines
Known allergies

RELEVANT HISTORY

Previous similar episodes

LAB FINDINGS

Relevant values/trends

AI ASSISTANCE

Analyst agreement
Analyst disagreement
Missing information
Uncertainty / points for review

HISTORICAL TREATMENT

Previous relevant prescriptions

PATIENT QUESTIONS

SOURCE DOCUMENTS
```

Doctors must be able to verify AI-prepared information against sources.

---

## 39. Explainability

Do not expose raw chain-of-thought.

Provide evidence-based explanations such as:

> A similar episode was found on 14 February 2026. At that time, the record shows a dry cough for five days without fever. A prescription linked to that encounter contains Medicine X.

---

## 40. Factual record vs AI inference

Doctor UI should visually separate them.

```text
PATIENT RECORD        AI ASSISTANCE
──────────────        ─────────────
Observed facts        Suggested relevance
Reports               Similarity analysis
Prescriptions         Missing questions
Labs                  Potential patterns
Doctor notes          AI uncertainty
```

AI inference must never silently become authoritative clinical history.

---

## 41. Prescription finalization and AI edits

AI may:
- OCR,
- transcribe,
- structure,
- format,
- draft,
- flag possible issues.

Once a doctor finalizes a prescription:
- AI cannot silently modify it,
- edits create an explicit amendment/new version,
- changes are auditable.

---

## 42. Doctor deletion/removal requests

Patients may request that a doctor remove records.

CliniX should support the request workflow.

However:
- deletion is not automatic,
- applicable professional/legal retention rules control the outcome,
- request and resolution should be auditable,
- doctor retains control over records they are required/entitled to retain.

---

## 43. Initial technology direction

### Frontend
- Next.js (App Router) + TypeScript
- Single app with role-based routing (`/app/patient`, `/app/doctor`)
- shadcn/ui + Tailwind CSS v4
- TanStack Query for data fetching
- React Hook Form + Zod for structured forms
- structured adaptive-question components
- patient dashboard
- doctor dashboard

### Backend
- TypeScript
- Fastify (modular monolith)
- Zod for request/response validation
- Drizzle ORM for database access
- pg-boss for background jobs (Postgres-backed queue, no Redis)

### Authentication
- Clerk for login/session management only
- Application roles (patient, doctor, clinic_staff, admin) stored in Postgres
- Clerk webhook creates profiles row on signup
- Unclaimed patients exist before any Clerk account

### Database
- PostgreSQL
- Supabase Cloud for prototype
- pgvector for semantic retrieval
- Drizzle ORM + drizzle-kit for migrations
- Row-Level Security for defense-in-depth

### Storage
- Supabase Storage with private buckets and signed URLs
- India-resident controlled object storage for production

### AI
Prototype:
- 9Router via OpenAI Node SDK
- ModelGateway abstraction with role-based routing
- Analyst 1 and Analyst 2 use different model families
- Strong model for Judge

Production:
- provider-independent Model Gateway
- controlled India-resident inference

### Document processing
- OCR via Gemini 2.5 Flash multimodal (through 9Router),
- voice transcription via Whisper (through 9Router),
- structured validation with Zod,
- mandatory confirmation for high-risk medication extraction.

### Hosting
- Dokploy compose on VPS (frontend + API as separate services)
- Supabase Cloud for Postgres/Storage
- npm workspaces monorepo

---

## 44. ABDM direction

Long-term CliniX should aim to interoperate with India's digital-health ecosystem rather than remain a proprietary island.

Potential future integrations:
- ABHA,
- Healthcare Professional Registry,
- Health Facility Registry,
- patient-controlled health-information exchange,
- consent-based sharing.

Not required for college MVP.

---

## 45. Non-goals for the initial MVP

The MVP does not attempt to:
- replace emergency medical services,
- provide pediatric care,
- provide pregnancy-specific care,
- replace hospital EMRs,
- implement full ABDM integration,
- build a full payment marketplace,
- clinically validate autonomous diagnosis,
- fully automate handwritten-prescription interpretation without doctor confirmation.

---

## 46. Accepted Round decisions

### Round 1
- Adults 18+.
- Non-emergency/non-critical scope.
- Longitudinal patient profile.
- All four input categories retained.
- Ayurveda is secondary personalization.
- Low-risk self-care / consultation preparation retained.
- Emergency-risk gate retained.

### Round 2
- Patient-assistant path + optional doctor-decision-support path.
- Accuracy measured by subsystem.
- Forms + PDFs + scans/images.
- Structured lab observations + original source documents.
- 2 analyst LLMs + 1 judge.
- Multi-factor historical-episode matching.
- Encounter-linked medication records.
- Ayurveda does not drive biomedical diagnosis/prescribing.

### Round 3
- Structured adaptive UI rather than visible chatbot-first UI.
- Hybrid SQL + vector retrieval.
- Manual + extracted medication history.
- Disagreement raises uncertainty.
- Minimum-necessary Evidence Bundle.
- Evidence-based explanations rather than raw reasoning.
- Doctor review packet.
- India-resident production goal.
- Private one-off mode + opt-in Health Vault.
- Doctor value includes a full management/clinical OS.
- Production avoids indiscriminate third-party LLM exposure.
- Prototype uses 9Router with synthetic data.

### Round 4
- Patient controls the longitudinal vault.
- Doctors retain professional records they create, including prescriptions.
- Patient may request doctor-side removal; outcome is subject to doctor/legal retention obligations.
- Doctors can create records for patients without CliniX accounts and invite them by mobile.
- Do not attempt to replace existing hospital/clinic software immediately.
- AI/OCR/voice may create prescription drafts; only doctor approval finalizes.
- Payments are manually tracked initially.
- Advance payment may be recommended for online visits but remains doctor-controlled.
- Multiple doctors per patient are supported.
- Factual patient records and AI assistance should remain clearly separated in the doctor interface.

---

## 47. Still-open decisions

These remain to be specified:

1. Exact wording/legal positioning of the patient AI medication/self-care route.
2. Exact production infrastructure/vendor choices.
3. Exact production models for Analyst 1, Analyst 2, and Judge.
4. Exact deterministic clinical safety rules.
5. Doctor credential-verification workflow.
6. Exact telemedicine compliance workflow.
7. Record-retention periods.
8. Consent-token lifecycle and authorization model.
9. ABDM integration scope.
10. Exact draft-notification / doctor-review UX.
11. Video consultation provider.
12. Automated payments beyond manual tracking.
13. Export/deletion implementation.
14. Whether AI assistance is visible to doctors by default or user-configurable.
15. Whether the MVP includes a real RMP pilot or only demo/test doctor accounts.

---

## 48. Immediate next course of action

Convert this context into an implementable **CliniX v2 technical specification**.

The first architecture/specification pass should define:

1. system/service architecture,
2. patient application,
3. doctor application,
4. authentication/identity,
5. patient-vault data model,
6. doctor-owned clinical-record model,
7. encounters,
8. appointments,
9. prescriptions and versions,
10. OCR/voice draft pipeline,
11. three-LLM orchestration,
12. retrieval/context builder,
13. safety engine,
14. consent/access-control model,
15. access ledger,
16. report/file pipeline,
17. prototype deployment,
18. production deployment,
19. MVP boundaries and milestones.

---

## 49. Current product summary

CliniX AI is a privacy-first health-record and clinical-workflow platform for adults.

For patients it provides:
- a Personal Health Vault,
- structured AI-assisted questioning,
- organized medical history,
- lab/report/prescription storage,
- historical episode retrieval,
- consultation preparation,
- low-risk preventive/self-care support,
- regular-doctor relationships,
- online/offline appointment booking,
- consent-controlled sharing,
- access transparency.

For doctors it provides:
- patient management,
- scheduling,
- pre-organized consultation records,
- clinical timelines,
- direct prescription entry,
- paper-prescription OCR drafts,
- voice prescription drafts,
- deferred draft review,
- printing,
- longitudinal records,
- follow-ups,
- AI-assisted record organization.

Both sides operate on the same encounter-based health ecosystem while preserving distinct ownership, consent, access, professional-record retention, and audit boundaries.

AI helps organize, retrieve, compare, summarize, question, and assist.

**AI-generated inference is never silently treated as an authoritative clinical record.**

---

## 50. Clinic staff language and boundaries

**CliniX Account**:
A person's persistent identity in CliniX. One account may hold Patient, Doctor, Clinic Staff, or Admin workspace entitlements simultaneously.

**Workspace Entitlement**:
The right to enter a specific CliniX workspace. Changing employment or professional status changes entitlements without replacing the person's account or Patient Vault.

**Practice**:
A clinic-level care organization containing doctors and staff. Staff access is granted through a Practice Membership, not through permanent attachment to one doctor.

**Practice Membership**:
A time-bounded relationship between a CliniX Account and a Practice that defines the member's role and access. Ending a membership removes future practice access while preserving the audit history.

**Practice Invitation**:
An invitation from a Practice owner or authorized doctor that offers a specific Clinic Staff role. Clinic Staff cannot grant themselves a Practice Membership through public signup.

**Active Practice**:
The Practice whose permitted patients, appointments, and tasks are currently shown when a person belongs to multiple practices.

**Staff-Doctor Assignment**:
A Practice-scoped workload relationship assigning a Clinical Assistant to one or more doctors. It controls schedule and task routing but does not independently grant access to every patient or clinical record associated with those doctors.

**Clinic Staff**:
A workspace entitlement granted by Practice invitation. Clinic Staff access is operational and limited by the member's practice-level role.

**Receptionist**:
A Clinic Staff role responsible for appointments, necessary patient contact details, patient invitations, payment status, and non-clinical follow-up contact.

**Clinical Assistant / Nurse**:
A Clinic Staff role that includes Receptionist capabilities plus appointment-scoped intake, basic observations, document uploads, and doctor-assigned follow-up tasks. It does not authorize diagnosis, prescribing, prescription approval, or unrestricted Patient Vault access.

**Platform Administrator**:
An internal CliniX application-management role responsible for platform operations, verification workflows, account and Practice administration, support, security oversight, and product analytics. It is distinct from a Practice Owner and does not grant routine access to identifiable Patient Vault or doctor-authored clinical content.

### Example dialogue

> **Practice owner:** Add Priya as a Receptionist for Lakeside Clinic.
>
> **CliniX:** Priya's Practice Membership grants operational access only. Her separate Patient workspace is unaffected.
>
> **Practice owner:** Priya has left Lakeside and joined Hillview Clinic as a Clinical Assistant.
>
> **CliniX:** End the Lakeside membership and create a Hillview membership. Prior access events remain in the ledger.
