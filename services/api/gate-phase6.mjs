import { config } from "dotenv";
import { createGateUser, findGateUser, sessionTokenFor } from "./gate-auth.mjs";
import postgres from "postgres";

config({ path: new URL("./.env", import.meta.url).pathname });

// Phase 6 gate: consent scoping, access ledger, append-only enforcement, record removal.
// Needs the API on :4000, migrations 0011/0012 applied, and a synthetic doctor account.
const API = "http://localhost:4000/api/v1";
const sql = postgres(process.env.DATABASE_URL);

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

async function main() {
  console.log("=== CliniX AI Phase 6 Gate: Privacy (consent, ledger, removal) ===");

  const doctorUser = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
  if (!doctorUser) throw new Error("Configure SUPABASE_GATE_DOCTOR_EMAIL in services/api/.env");
  const doctorToken = await sessionTokenFor(doctorUser.id);
  const doctorId = (await api(doctorToken, "GET", "/me")).json?.doctor_id;
  check("Doctor profile resolved", Boolean(doctorId));

  const tag = `p6_${Date.now()}`;
  const patientUser = await createGateUser(tag, { display_name: "Synthetic Privacy Patient" });
  const patientToken = await sessionTokenFor(patientUser.id);
  const onb = await api(patientToken, "POST", "/patients/self", {
    full_name: "Synthetic Privacy Patient", phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`, date_of_birth: "1990-01-01", sex_at_registration: "FEMALE",
  });
  check("Synthetic patient onboarded", onb.status === 201 || onb.status === 200);
  const patientId = onb.json?.patient_id;
  check("Patient id resolved", Boolean(patientId));
  await api(patientToken, "POST", `/patients/self/doctors/${doctorId}/relationships`, { relationship_type: "PRIMARY_PHYSICIAN", preferred: true });

  // Consent lifecycle: scoped read opens, revoke closes (locked, not omitted).
  const before = await api(doctorToken, "GET", `/doctor/patients/${patientId}/workspace`);
  check("Related doctor sees own-records scope only", before.json?.access_scope === "DOCTOR_OWN_RECORDS");
  check("Uncovered groups are reported as locked", (before.json?.locked_sections ?? []).length === 5);

  const preview = await api(patientToken, "POST", "/patients/self/consents/preview", { doctor_id: doctorId });
  check("Consent preview lists scopes", (preview.json?.suggested_scopes ?? []).length > 0);
  const grant = await api(patientToken, "POST", "/patients/self/consents", {
    doctor_id: doctorId, purpose: "Gate follow-up", expiry: "7_DAYS", scopes: [{ resource_type: "MEDICATION" }],
  });
  check("Consent created", grant.status === 201, grant.json?.id);
  const consentId = grant.json?.id;

  const during = await api(doctorToken, "GET", `/doctor/patients/${patientId}/workspace`);
  check("Consent widens the workspace", during.json?.access_scope === "CONSENT_SCOPED" && during.json?.consent_active === true);
  check("Remaining groups stay locked", (during.json?.locked_sections ?? []).length === 4);

  // Ledger: the doctor's view is visible to the patient and carries the consent id.
  const ledger = await api(patientToken, "GET", "/patients/self/access-ledger");
  const viewRow = (ledger.json?.events ?? []).find((e) => e.actor?.type === "DOCTOR" && e.consent_id === consentId);
  check("Doctor view appears on the patient's ledger with its consent", Boolean(viewRow));
  check("Ledger shows the consent grant", (ledger.json?.events ?? []).some((e) => e.action === "Shared"));

  const revoke = await api(patientToken, "POST", `/patients/self/consents/${consentId}/revoke`);
  check("Consent revoked", revoke.status === 200);
  const after = await api(doctorToken, "GET", `/doctor/patients/${patientId}/workspace`);
  check("Revoked consent locks the sections again", after.json?.access_scope === "DOCTOR_OWN_RECORDS" && (after.json?.locked_sections ?? []).length === 5);

  const foreign = await api(doctorToken, "GET", "/patients/self/access-ledger");
  check("A doctor cannot read a patient ledger", foreign.status === 403);

  // DB-enforced append-only ledger.
  let blocked = false;
  try { await sql`UPDATE access_events SET purpose = 'tamper' WHERE patient_id = ${patientId}`; } catch { blocked = true; }
  check("UPDATE on access_events is rejected by the database", blocked);
  blocked = false;
  try { await sql`DELETE FROM access_events WHERE patient_id = ${patientId}`; } catch { blocked = true; }
  check("DELETE on access_events is rejected by the database", blocked);

  // Removal request: request, then only the addressed doctor resolves it.
  const req = await api(patientToken, "POST", "/patients/self/record-removal-requests", {
    target_actor_type: "DOCTOR", target_actor_id: doctorId, resource_type: "DOCUMENT", reason: "Synthetic gate request",
  });
  check("Removal request created", req.status === 201 && req.json?.status === "OPEN");
  const noReason = await api(doctorToken, "POST", `/doctor/record-removal-requests/${req.json?.id}/resolve`, { outcome: "DENIED" });
  check("Retention needs a written reason", noReason.status === 400);
  const resolved = await api(doctorToken, "POST", `/doctor/record-removal-requests/${req.json?.id}/resolve`, { outcome: "DENIED", reason: "Retained as part of the clinical record." });
  check("Doctor resolved the request", resolved.status === 200 && resolved.json?.status === "DENIED");
  const tracked = await api(patientToken, "GET", "/patients/self/record-removal-requests");
  check("Patient sees the outcome and reason", tracked.json?.[0]?.status === "DENIED" && Boolean(tracked.json?.[0]?.resolution_note));

  console.log("\n========================================================");
  console.log(process.exitCode ? "❌ Phase 6 gate FAILED" : "✅ Phase 6 gate PASSED");
  console.log("========================================================\n");
}

main().catch((err) => { console.error("Gate script threw error:", err); process.exit(1); }).finally(() => sql.end());
