import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { createClerkClient } from "@clerk/backend";
import postgres from "postgres";

config({ path: new URL("./.env", import.meta.url).pathname });

const API = "http://localhost:4000/api/v1";
const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const sql = postgres(process.env.DATABASE_URL);

const rxPng = readFileSync(new URL("./fixtures/rx_synthetic.png", import.meta.url));
const labPdf = readFileSync(new URL("./fixtures/lab_synthetic.pdf", import.meta.url));

async function sessionTokenFor(userId) {
  const session = await clerk.sessions.createSession({ userId });
  const token = await clerk.sessions.getToken(session.id);
  return token.jwt;
}

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

async function putRaw(uploadUrl, buf, mime) {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mime },
    body: buf,
  });
  return res.status;
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls a document view until it leaves UPLOADED/PROCESSING, or times out. */
async function pollDocument(token, path, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await api(token, "GET", path);
    const s = res.json?.processing_status;
    if (s === "COMPLETE" || s === "NEEDS_REVIEW" || s === "FAILED") return res.json;
    await sleep(2000);
  }
  return null;
}

const rndMobile = () => `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;

const users = (await clerk.users.getUserList({ limit: 100 })).data;
const doctorUser = users.find((u) => u.emailAddresses[0]?.emailAddress === "doctor_test@example.com");
if (!doctorUser) {
  console.log("MISSING doctor_test user");
  process.exit(1);
}
const doctorToken = await sessionTokenFor(doctorUser.id);
const doctorMe = await api(doctorToken, "GET", "/me");
check("doctor /me → DOCTOR", doctorMe.json?.role === "DOCTOR" && !!doctorMe.json?.doctor_id, doctorMe.json?.role);
const doctorId = doctorMe.json?.doctor_id;

// 1. Doctor-side unclaimed patient + encounter (needed for the Rx draft to finalize).
const createP = await api(doctorToken, "POST", "/doctor/patients", {
  full_name: "Synthetic Phase4", mobile: rndMobile(), date_of_birth: "1990-01-01", sex_at_registration: "female",
});
check("create unclaimed patient → 201", createP.status === 201, createP.status);
const patientId = createP.json?.patient_id;

const invite = await api(doctorToken, "POST", `/doctor/patients/${patientId}/claim-invites`, {});
check("claim invite → 201", invite.status === 201 && typeof invite.json?.invite_token === "string", invite.status);
const inviteToken = invite.json?.invite_token;

const enc = await api(doctorToken, "POST", "/doctor/encounters", { patient_id: patientId });
check("create encounter → 201", enc.status === 201, enc.status);
const encounterId = enc.json?.encounter_id;

// 2. Doctor uploads printed Rx photo → OCR draft (Test Milestone C, Rx leg).
const rxInit = await api(doctorToken, "POST", `/doctor/patients/${patientId}/documents/upload-init`, {
  filename: "rx_synthetic.png", mime_type: "image/png", document_type: "PRESCRIPTION", encounter_id: encounterId,
});
check("rx upload-init → 201", rxInit.status === 201 && rxInit.json?.upload_url && rxInit.json?.document_id, rxInit.status);
const rxDocId = rxInit.json?.document_id;

const rxPut = await putRaw(rxInit.json.upload_url, rxPng, "image/png");
check("rx PUT to storage → 200", rxPut === 200, rxPut);

const rxComplete = await api(doctorToken, "POST", `/doctor/patients/${patientId}/documents/${rxDocId}/upload-complete`, {});
check("rx upload-complete → 200", rxComplete.status === 200, rxComplete.status);

const rxDoc = await pollDocument(doctorToken, `/doctor/documents/${rxDocId}`);
check("rx document processed → NEEDS_REVIEW", rxDoc?.processing_status === "NEEDS_REVIEW", rxDoc?.processing_status);

// 3. OCR draft appears in the doctor's queue with confidence + items.
const queue = await api(doctorToken, "GET", "/doctor/prescription-drafts");
const ocrDraft = queue.json?.find((d) => d.source === "OCR" && d.patient_id === patientId && d.status === "NEEDS_REVIEW");
check("OCR draft in queue (NEEDS_REVIEW)", !!ocrDraft, ocrDraft ? `items=${ocrDraft.items?.length}` : "missing");
check("draft has overall_confidence", ocrDraft?.overall_confidence != null, ocrDraft?.overall_confidence);
check("draft has ≥1 medicine", (ocrDraft?.items?.length ?? 0) >= 1, ocrDraft?.items?.length);
check("draft has source_document_id", !!ocrDraft?.source_document_id, ocrDraft?.source_document_id);
const draftId = ocrDraft?.id;

// 4. Doctor corrects one field, then finalizes (immutable Version 1).
const corrected = (ocrDraft.items ?? []).map((it, i) => ({
  medicine_name: it.medicine_name,
  strength: it.strength,
  dose: i === 0 ? "1 capsule" : it.dose, // deliberate correction
  route: it.route,
  frequency: it.frequency,
  timing: it.timing,
  duration: it.duration,
  instructions: it.instructions,
}));
const patch = await api(doctorToken, "PATCH", `/doctor/prescription-drafts/${draftId}`, { items: corrected });
check("patch OCR draft (correct field) → 200", patch.status === 200, patch.status);

const fin = await api(doctorToken, "POST", `/doctor/prescription-drafts/${draftId}/finalize`, {}, { "Idempotency-Key": "gate4-key-1" });
check("finalize OCR draft → 201", fin.status === 201, fin.status);
check("version 1 + ACTIVE", fin.json?.current_version?.version_number === 1 && fin.json?.status === "ACTIVE", `v${fin.json?.current_version?.version_number}`);
const prescriptionId = fin.json?.id;
const replay = await api(doctorToken, "POST", `/doctor/prescription-drafts/${draftId}/finalize`, {}, { "Idempotency-Key": "gate4-key-1" });
check("re-finalize → 200 same prescription", replay.status === 200 && replay.json?.id === prescriptionId, replay.status);

// 5. Patient claims the record and sees the final Rx.
const mkUser = async (tag) => {
  const u = await clerk.users.createUser({
    emailAddress: [`${tag}-${Date.now()}+clerk_test@example.com`],
    phoneNumber: [`+1650555${String(Math.floor(1000 + Math.random() * 9000)).padStart(4, "0")}`],
    password: "TestPass123!@#$%",
  });
  return u;
};
const userA = await mkUser("phase4");
const tokenA = await sessionTokenFor(userA.id);
const claim = await api(tokenA, "POST", "/patient-claims", { invite_token: inviteToken });
check("patient claims record → 200", claim.status === 200 && claim.json?.patient_id === patientId, claim.status);

const patRx = await api(tokenA, "GET", `/patients/self/prescriptions/${prescriptionId}`);
check("patient sees final Rx → 200 v1", patRx.status === 200 && patRx.json?.current_version?.version_number === 1, patRx.status);

// 6. Patient uploads synthetic lab PDF → observations + trend (Test Milestone C, lab leg).
const labInit = await api(tokenA, "POST", "/patients/self/documents/upload-init", {
  filename: "lab_synthetic.pdf", mime_type: "application/pdf", document_type: "LAB_REPORT",
});
check("lab upload-init → 201", labInit.status === 201 && labInit.json?.upload_url, labInit.status);
const labDocId = labInit.json?.document_id;
const labPut = await putRaw(labInit.json.upload_url, labPdf, "application/pdf");
check("lab PUT to storage → 200", labPut === 200, labPut);
const labComplete = await api(tokenA, "POST", `/patients/self/documents/${labDocId}/upload-complete`, {});
check("lab upload-complete → 200", labComplete.status === 200, labComplete.status);
const labDoc = await pollDocument(tokenA, `/patients/self/documents/${labDocId}`);
check("lab document processed", labDoc?.processing_status === "COMPLETE" || labDoc?.processing_status === "NEEDS_REVIEW", labDoc?.processing_status);

const reports = await api(tokenA, "GET", "/patients/self/lab-reports");
check("lab reports listed ≥1", reports.status === 200 && (reports.json?.length ?? 0) >= 1, `count=${reports.json?.length}`);
const reportId = reports.json?.[0]?.report_id;
const report = await api(tokenA, "GET", `/patients/self/lab-reports/${reportId}`);
const obs = report.json?.observations ?? [];
check("report has observations ≥2", obs.length >= 2, `count=${obs.length}`);
const numericObs = obs.find((o) => o.value_numeric != null);
check("at least one numeric value", !!numericObs, numericObs?.test_name);
check("observation has reference_text", obs.some((o) => o.reference_text != null), obs.map((o) => o.reference_text).join(","));
check("observation has confidence", obs.some((o) => o.confidence != null), obs.map((o) => o.confidence).join(","));

// 7. Confirm one observation (Screen 9 correction/confirmation path).
const target = obs.find((o) => o.needs_review) ?? obs[0];
const confirm = await api(tokenA, "PATCH", `/patients/self/lab-observations/${target.id}`, {
  value_numeric: target.value_numeric, confirmed: true,
});
check("confirm observation → 200", confirm.status === 200, confirm.status);

// 8. Trend series for a numeric test.
const trendTest = numericObs?.test_name;
const trend = await api(tokenA, "GET", `/patients/self/lab-observations?test_name=${encodeURIComponent(trendTest)}`);
check("trend has ≥1 point", trend.status === 200 && (trend.json?.points?.length ?? 0) >= 1, `points=${trend.json?.points?.length}`);

// 9. SQL assertions: documents metadata + append-only ledger + extraction row.
const docRows = await sql`SELECT sha256, file_size_bytes, processing_status FROM documents WHERE id = ${labDocId}`;
check("document has sha256 + size", !!docRows[0]?.sha256 && docRows[0]?.file_size_bytes != null, `size=${docRows[0]?.file_size_bytes}`);
const events = await sql`SELECT actor_type, action FROM access_events WHERE patient_id = ${patientId}`;
const kinds = events.map((e) => `${e.actor_type}:${e.action}`);
check("access_events has UPLOAD_INIT", kinds.includes("PATIENT:UPLOAD_INIT") || kinds.includes("DOCTOR:UPLOAD_INIT"), kinds.join(","));
check("access_events has UPLOAD_COMPLETE", kinds.includes("PATIENT:UPLOAD_COMPLETE") || kinds.includes("DOCTOR:UPLOAD_COMPLETE"), kinds.join(","));
check("access_events has AI_SERVICE OCR_EXTRACT", kinds.includes("AI_SERVICE:OCR_EXTRACT"), kinds.join(","));
const exts = await sql`SELECT count(*)::int AS n FROM document_extractions WHERE document_id = ${labDocId}`;
check("document_extractions row exists", exts[0]?.n >= 1, `n=${exts[0]?.n}`);

await sql.end();
console.log("\nDONE");
