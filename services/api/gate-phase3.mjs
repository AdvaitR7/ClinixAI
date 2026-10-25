import { config } from "dotenv";
import { createGateUser, findGateUser, sessionTokenFor } from "./gate-auth.mjs";
import postgres from "postgres";

config({ path: new URL("./.env", import.meta.url).pathname });

const API = "http://localhost:4000/api/v1";
const sql = postgres(process.env.DATABASE_URL);


async function api(token, method, path, body, headers) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function apiRaw(token, method, path, body, headers) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, contentType: res.headers.get("content-type"), body: buf };
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const rndMobile = () => `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;

const doctorUser = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
if (!doctorUser) {
  console.log("Configure SUPABASE_GATE_DOCTOR_EMAIL in services/api/.env");
  process.exit(1);
}
const doctorToken = await sessionTokenFor(doctorUser.id);
const doctorMe = await api(doctorToken, "GET", "/me");
check("doctor /me → DOCTOR", doctorMe.json?.role === "DOCTOR" && !!doctorMe.json?.doctor_id, doctorMe.json?.role);
const doctorId = doctorMe.json?.doctor_id;

// 1. Doctor-side unclaimed patient
const mobile = rndMobile();
const createP = await api(doctorToken, "POST", "/doctor/patients", {
  full_name: "Synthetic Phase3", mobile, date_of_birth: "1990-01-01", sex_at_registration: "female",
});
check("create unclaimed patient → 201", createP.status === 201, createP.status);
const patientId = createP.json?.patient_id;

// 2. Claim invite
const invite = await api(doctorToken, "POST", `/doctor/patients/${patientId}/claim-invites`, {});
check("claim invite → 201 + token", invite.status === 201 && typeof invite.json?.invite_token === "string", invite.status);
const inviteToken = invite.json?.invite_token;

// 3. Doctor-side booking
const start = new Date(Date.now() + 2 * 86400000);
start.setUTCMinutes(0, 0, 0);
const book = await api(doctorToken, "POST", "/doctor/appointments", {
  patient_id: patientId, appointment_type: "IN_PERSON", scheduled_start: start.toISOString(), reason: "Recurring cough",
});
check("doctor books walk-in → 201 CONFIRMED", book.status === 201 && book.json?.appointment?.status === "CONFIRMED", book.json?.appointment?.status);
const apptId = book.json?.appointment?.id;

// 4. Doctor encounter (find-or-create)
const enc = await api(doctorToken, "POST", "/doctor/encounters", { patient_id: patientId, appointment_id: apptId });
check("create encounter → 201", enc.status === 201, enc.status);
const encounterId = enc.json?.encounter_id;
const enc2 = await api(doctorToken, "POST", "/doctor/encounters", { patient_id: patientId, appointment_id: apptId });
check("repeat encounter → 200 same id", enc2.status === 200 && enc2.json?.encounter_id === encounterId, enc2.json?.encounter_id);

// 5. Note autosave + consultation context
const note = await api(doctorToken, "PUT", `/doctor/encounters/${encounterId}/note`, {
  complaint: "Cough for 5 days", assessment: "Viral", plan: "Symptomatic care",
});
check("put note → 200", note.status === 200, note.status);
const ctx = await api(doctorToken, "GET", `/doctor/appointments/${apptId}/consultation`);
check("consultation context note visible", ctx.status === 200 && ctx.json?.note?.complaint === "Cough for 5 days", ctx.json?.note?.complaint);

// 6. Draft (OCR rejected, DIRECT_ENTRY accepted)
const badDraft = await api(doctorToken, "POST", `/doctor/encounters/${encounterId}/prescription-drafts`, {
  source: "OCR", items: [{ medicine_name: "X" }],
});
check("OCR source → 400 (Phase 4 rail)", badDraft.status === 400, badDraft.status);
const draft = await api(doctorToken, "POST", `/doctor/encounters/${encounterId}/prescription-drafts`, {
  source: "DIRECT_ENTRY",
  items: [
    { medicine_name: "Paracetamol", strength: "500 mg", dose: "1 tablet", frequency: "Twice daily" },
    { medicine_name: "Amoxicillin", strength: "250 mg", dose: "1 capsule", frequency: "Three times daily" },
  ],
});
check("create direct draft → 201", draft.status === 201 && draft.json?.items?.length === 2, draft.status);
const draftId = draft.json?.id;

// 7. Patch draft
const patch = await api(doctorToken, "PATCH", `/doctor/prescription-drafts/${draftId}`, {
  items: [
    { medicine_name: "Paracetamol", strength: "650 mg", dose: "1 tablet", frequency: "Twice daily" },
    { medicine_name: "Amoxicillin", strength: "250 mg", dose: "1 capsule", frequency: "Three times daily" },
  ],
});
check("patch draft → 200", patch.status === 200, patch.status);
const queue = await api(doctorToken, "GET", "/doctor/prescription-drafts");
check("draft queue lists patient", queue.json?.some((d) => d.id === draftId && d.patient_name === "Synthetic Phase3"), `count=${queue.json?.length}`);

// 8. Finalize — idempotency key required
const noKey = await api(doctorToken, "POST", `/doctor/prescription-drafts/${draftId}/finalize`, {});
check("finalize without key → 400 IDEMPOTENCY_KEY_REQUIRED", noKey.status === 400 && noKey.json?.error?.code === "IDEMPOTENCY_KEY_REQUIRED", noKey.json?.error?.code);

// 9. Finalize with key
const fin = await api(doctorToken, "POST", `/doctor/prescription-drafts/${draftId}/finalize`, {}, { "Idempotency-Key": "gate-key-1" });
check("finalize → 201", fin.status === 201, fin.status);
check("version 1 + 2 items + ACTIVE", fin.json?.current_version?.version_number === 1 && fin.json?.current_version?.items?.length === 2 && fin.json?.status === "ACTIVE", `v${fin.json?.current_version?.version_number}`);
const prescriptionId = fin.json?.id;
const finDraft = await api(doctorToken, "GET", `/doctor/prescription-drafts/${draftId}`);
check("draft marked APPROVED", finDraft.json?.status === "APPROVED", finDraft.json?.status);

// 10. Replay + immutability (no key store: any re-finalize replays the same prescription)
const replay = await api(doctorToken, "POST", `/doctor/prescription-drafts/${draftId}/finalize`, {}, { "Idempotency-Key": "gate-key-1" });
check("re-finalize → 200 same prescription", replay.status === 200 && replay.json?.id === prescriptionId, replay.status);
const patchApproved = await api(doctorToken, "PATCH", `/doctor/prescription-drafts/${draftId}`, {
  items: [{ medicine_name: "Z" }],
});
check("patch APPROVED draft → 409 DRAFT_FINALIZED", patchApproved.status === 409 && patchApproved.json?.error?.code === "DRAFT_FINALIZED", patchApproved.json?.error?.code);

// 11. Claim flow (self-contained: no dependency on a pre-existing patient user)
const mkUser = async (tag) => {
  const u = await createGateUser(tag);
  return u;
};

const userA = await mkUser("claim-a");
const tokenA = await sessionTokenFor(userA.id);
const claimA = await api(tokenA, "POST", "/patient-claims", { invite_token: inviteToken });
check("fresh user claims → 200, patient matches", claimA.status === 200 && claimA.json?.patient_id === patientId, claimA.json?.patient_id);

const claimA2 = await api(tokenA, "POST", "/patient-claims", { invite_token: inviteToken });
check("replay claim → 200 idempotent", claimA2.status === 200 && claimA2.json?.patient_id === patientId, claimA2.status);

const userB = await mkUser("claim-b");
const tokenB = await sessionTokenFor(userB.id);
const claimB = await api(tokenB, "POST", "/patient-claims", { invite_token: inviteToken });
check("second user same token → 409 INVITE_USED", claimB.status === 409 && claimB.json?.error?.code === "INVITE_USED", claimB.json?.error?.code);

// ACCOUNT_ALREADY_LINKED: userA (already owns a patient) tries a second invite
const mobile2 = rndMobile();
const createP2 = await api(doctorToken, "POST", "/doctor/patients", {
  full_name: "Synthetic P3b", mobile: mobile2, date_of_birth: "1991-02-02", sex_at_registration: "male",
});
const invite2 = await api(doctorToken, "POST", `/doctor/patients/${createP2.json?.patient_id}/claim-invites`, {});
const claimA3 = await api(tokenA, "POST", "/patient-claims", { invite_token: invite2.json?.invite_token });
check("already-linked user → 409 ACCOUNT_ALREADY_LINKED", claimA3.status === 409 && claimA3.json?.error?.code === "ACCOUNT_ALREADY_LINKED", claimA3.json?.error?.code);

// 12. Claimed patient reads prescription + medications
const patRx = await api(tokenA, "GET", `/patients/self/prescriptions/${prescriptionId}`);
check("patient sees prescription → 200 v1", patRx.status === 200 && patRx.json?.current_version?.version_number === 1, patRx.status);
const meds = await api(tokenA, "GET", "/patients/self/medications");
const medStatuses = meds.json?.medications?.map((m) => m.status) ?? [];
check("medications derived UNKNOWN_STATUS, never CURRENT", medStatuses.length > 0 && medStatuses.every((s) => s === "UNKNOWN_STATUS"), medStatuses.join(","));

// 13. Doctor workspace writes an access event
const ws = await api(doctorToken, "GET", `/doctor/patients/${patientId}/workspace`);
check("doctor workspace → 200 (VIEW event)", ws.status === 200, ws.status);

// 14. Amend → version 2, v1 unchanged
const amend = await api(doctorToken, "POST", `/doctor/prescriptions/${prescriptionId}/amend`, {
  reason: "Dose increase",
  items: [
    { medicine_name: "Paracetamol", strength: "650 mg", dose: "1 tablet", frequency: "Twice daily" },
    { medicine_name: "Amoxicillin", strength: "500 mg", dose: "1 capsule", frequency: "Three times daily" },
    { medicine_name: "Cetirizine", strength: "10 mg", dose: "1 tablet", frequency: "Once daily" },
  ],
});
check("amend → 201 version 2", amend.status === 201 && amend.json?.current_version?.version_number === 2, amend.json?.current_version?.version_number);
check("v1 items unchanged (2 items)", amend.json?.versions?.find((v) => v.version_number === 1)?.items?.length === 2, `v2 items=${amend.json?.current_version?.items?.length}`);
const patRx2 = await api(tokenA, "GET", `/patients/self/prescriptions/${prescriptionId}`);
check("patient view reflects v2", patRx2.json?.current_version?.version_number === 2 && patRx2.json?.current_version?.items?.length === 3, patRx2.json?.current_version?.version_number);

// 15. Render PDF
const pdf = await apiRaw(doctorToken, "POST", `/doctor/prescriptions/${prescriptionId}/render`, {});
check("render → 200 application/pdf", pdf.status === 200 && (pdf.contentType ?? "").includes("application/pdf"), pdf.contentType);
check("PDF magic bytes %PDF-", pdf.body.subarray(0, 5).toString() === "%PDF-", pdf.body.subarray(0, 5).toString());

// 16. Complete consultation finalizes note
const complete = await api(doctorToken, "POST", `/doctor/appointments/${apptId}/complete`, {});
check("complete → 200", complete.status === 200, complete.status);
const noteAfter = await api(doctorToken, "PUT", `/doctor/encounters/${encounterId}/note`, { complaint: "edited" });
check("put note after finalize → 409 NOTE_FINALIZED", noteAfter.status === 409 && noteAfter.json?.error?.code === "NOTE_FINALIZED", noteAfter.json?.error?.code);
const amendNote = await api(doctorToken, "POST", `/doctor/encounters/${encounterId}/note/amend`, {
  reason: "Correction", complaint: "Cough resolved",
});
check("note amend → 201", amendNote.status === 201, amendNote.status);

// 17. Access ledger (direct SQL; no ledger endpoint until Phase 6)
const events = await sql`
  SELECT actor_type, action FROM access_events WHERE patient_id = ${patientId}
`;
const kinds = events.map((e) => `${e.actor_type}:${e.action}`);
check("access_events has DOCTOR VIEW (workspace)", kinds.includes("DOCTOR:VIEW"), kinds.join(","));
check("access_events has PATIENT VIEW (prescription)", kinds.includes("PATIENT:VIEW"), kinds.join(","));
check("access_events has DOCTOR CREATE (finalize)", kinds.includes("DOCTOR:CREATE"), kinds.join(","));

await sql.end();
console.log("\nDONE");
