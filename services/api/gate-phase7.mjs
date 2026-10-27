import { config } from "dotenv";
import { createGateUser, findGateUser, sessionTokenFor } from "./gate-auth.mjs";
import postgres from "postgres";

config({ path: new URL("./.env", import.meta.url).pathname });

// Phase 7 gate: practice membership, staff intake, follow-ups, role bounds.
// Needs the API on :4000, migration 0013 (and 0009-0012) applied, and a synthetic doctor account.
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

/** Creates a synthetic staff account and accepts the invitation as that account. */
async function joinAs(tag, token) {
  const user = await createGateUser(tag, { display_name: `Synthetic ${tag}` });
  const userToken = await sessionTokenFor(user.id);
  const accepted = await api(userToken, "POST", `/practice-invitations/${token}/accept`);
  return { userToken, accepted };
}

async function main() {
  console.log("=== CliniX AI Phase 7 Gate: Staff & practice OS ===");

  const doctorUser = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
  if (!doctorUser) throw new Error("Configure SUPABASE_GATE_DOCTOR_EMAIL in services/api/.env");
  const doctorToken = await sessionTokenFor(doctorUser.id);
  const doctorId = (await api(doctorToken, "GET", "/me")).json?.doctor_id;
  check("Doctor profile resolved", Boolean(doctorId));

  const tag = `p7_${Date.now()}`;
  const practice = await api(doctorToken, "POST", "/practices", { name: `Synthetic Clinic ${tag}` });
  check("Doctor creates a practice", practice.status === 201, practice.json?.practice_id);
  const practiceId = practice.json?.practice_id;

  // Invitations: expired/revoked/declined tokens cannot be accepted; accepted ones grant exactly the invited role.
  const revokedInvite = await api(doctorToken, "POST", `/practices/${practiceId}/invitations`, { contact: `revoked-${tag}@example.test`, role: "RECEPTION" });
  await api(doctorToken, "POST", `/practices/${practiceId}/members/${revokedInvite.json?.member_id}/revoke`);
  const revoked = await joinAs(`${tag}r`, revokedInvite.json?.invite_token);
  check("A revoked invitation cannot be accepted", revoked.accepted.status === 409, revoked.accepted.json?.error?.code);

  const asstInvite = await api(doctorToken, "POST", `/practices/${practiceId}/invitations`, { contact: `assistant-${tag}@example.test`, role: "ASSISTANT" });
  const recInvite = await api(doctorToken, "POST", `/practices/${practiceId}/invitations`, { contact: `reception-${tag}@example.test`, role: "RECEPTION" });
  check("Invitations issue one-time tokens", Boolean(asstInvite.json?.invite_token) && Boolean(recInvite.json?.invite_token));
  const assistant = await joinAs(`${tag}a`, asstInvite.json?.invite_token);
  const receptionist = await joinAs(`${tag}c`, recInvite.json?.invite_token);
  check("Assistant accepts membership", assistant.accepted.status === 200 && assistant.accepted.json?.role === "ASSISTANT");
  check("Receptionist accepts membership", receptionist.accepted.status === 200 && receptionist.accepted.json?.role === "RECEPTION");
  const replay = await api(assistant.userToken, "POST", `/practice-invitations/${asstInvite.json?.invite_token}/accept`);
  check("An accepted invitation cannot be replayed", replay.status === 404 || replay.status === 409);

  // Synthetic patient and a doctor-booked appointment today.
  const patientUser = await createGateUser(`${tag}pt`, { display_name: "Synthetic Intake Patient" });
  const patientToken = await sessionTokenFor(patientUser.id);
  const onb = await api(patientToken, "POST", "/patients/self", {
    full_name: "Synthetic Intake Patient", phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`, date_of_birth: "1990-01-01", sex_at_registration: "FEMALE",
  });
  const patientId = onb.json?.patient_id;
  check("Synthetic patient onboarded", Boolean(patientId));
  await api(patientToken, "POST", `/patients/self/doctors/${doctorId}/relationships`, { relationship_type: "PRIMARY_PHYSICIAN", preferred: true });
  const start = new Date(Date.now() + 10 * 60000);
  const book = await api(doctorToken, "POST", "/doctor/appointments", { patient_id: patientId, appointment_type: "IN_PERSON", scheduled_start: start.toISOString(), reason: "Synthetic intake" });
  const apptId = book.json?.appointment?.id;
  check("Appointment booked", Boolean(apptId), book.status);

  // Intake: receptionist arrives, assistant records vitals, then Ready for Doctor.
  const dash = await api(receptionist.userToken, "GET", "/staff/dashboard");
  check("Receptionist sees the practice schedule", dash.status === 200 && (dash.json?.appointments ?? []).some((a) => a.id === apptId));
  const arrive = await api(receptionist.userToken, "POST", `/staff/appointments/${apptId}/arrive`);
  check("Receptionist marks arrival", arrive.status === 200 && arrive.json?.intake_status === "ARRIVED");
  const recVitals = await api(receptionist.userToken, "PUT", `/staff/appointments/${apptId}/vitals`, { temperature_c: 37 });
  check("Receptionist cannot enter vitals", recVitals.status === 403);
  const recIntake = await api(receptionist.userToken, "GET", `/staff/appointments/${apptId}/intake`);
  check("Receptionist intake view is arrival-only", recIntake.json?.clinical_intake_locked === true && (recIntake.json?.vitals ?? []).length === 0);
  const earlyReady = await api(assistant.userToken, "POST", `/staff/appointments/${apptId}/ready`);
  check("Ready needs vitals first", earlyReady.status === 409);
  const vitals = await api(assistant.userToken, "PUT", `/staff/appointments/${apptId}/vitals`, { temperature_c: 38.6, pulse_bpm: 96, spo2_percent: 97 });
  check("Assistant records vitals with staff provenance", vitals.status === 201 && vitals.json?.provenance === "CLINIC_STAFF");
  check("Out-of-range value is flagged for doctor review", vitals.json?.needs_doctor_review === true);
  const ready = await api(assistant.userToken, "POST", `/staff/appointments/${apptId}/ready`);
  check("Assistant marks Ready for Doctor", ready.status === 200 && ready.json?.intake_status === "READY_FOR_DOCTOR");

  const doctorView = await api(doctorToken, "GET", `/doctor/appointments/${apptId}/intake`);
  check("Doctor sees staff vitals and the ready state", doctorView.json?.intake_status === "READY_FOR_DOCTOR" && doctorView.json?.vitals?.[0]?.provenance === "CLINIC_STAFF");

  // Role bounds: staff cannot reach clinical routes.
  const enc = await api(doctorToken, "POST", "/doctor/encounters", { patient_id: patientId, appointment_id: apptId });
  const encounterId = enc.json?.encounter_id;
  for (const [name, method, path] of [
    ["Page 17 workspace", "GET", `/doctor/patients/${patientId}/workspace`],
    ["Page 18 consultation", "GET", `/doctor/appointments/${apptId}/consultation`],
    ["Page 19 drafts", "GET", "/doctor/prescription-drafts"],
  ]) {
    const res = await api(receptionist.userToken, method, path);
    check(`Receptionist is denied ${name}`, res.status === 403, res.status);
    const res2 = await api(assistant.userToken, method, path);
    check(`Assistant is denied ${name}`, res2.status === 403, res2.status);
  }

  // Follow-ups: doctor creates, staff handle contact but cannot write the outcome.
  const fu = await api(doctorToken, "POST", `/doctor/encounters/${encounterId}/followups`, { due_at: new Date(Date.now() + 86400000).toISOString(), reason: "Synthetic follow-up", practice_id: practiceId });
  check("Doctor creates a follow-up", fu.status === 201, fu.status);
  const fid = fu.json?.id;
  const list = await api(receptionist.userToken, "GET", "/followups");
  check("Staff see the practice follow-up", (list.json ?? []).some((f) => f.id === fid));
  const contact = await api(receptionist.userToken, "PATCH", `/followups/${fid}`, { contact_status: "REACHED" });
  check("Staff record contact status", contact.status === 200 && contact.json?.contact_status === "REACHED");
  const outcome = await api(receptionist.userToken, "PATCH", `/followups/${fid}`, { outcome: "Resolved" });
  check("Staff cannot write the clinical outcome", outcome.status === 403);
  const done = await api(receptionist.userToken, "POST", `/followups/${fid}/complete`, {});
  check("Staff complete the task operationally", done.status === 200 && done.json?.status === "COMPLETED");

  // Membership lifecycle: ended membership loses access, history stays.
  const end = await api(doctorToken, "POST", `/practices/${practiceId}/members/${receptionist.accepted.json?.member_id}/end`, { reason: "Synthetic gate end", effective_date: new Date().toISOString().slice(0, 10) });
  check("Owner ends a membership", end.status === 200 && end.json?.status === "FORMER");
  const after = await api(receptionist.userToken, "GET", "/staff/dashboard");
  check("Ended member loses access", after.status === 403);
  const team = await api(doctorToken, "GET", `/practices/${practiceId}/members`);
  check("Ended member stays in history", (team.json ?? []).some((m) => m.status === "FORMER" && m.end_reason));
  const manage = await api(assistant.userToken, "GET", `/practices/${practiceId}/members`);
  check("Staff cannot manage the team", manage.status === 403);

  console.log("\n========================================================");
  console.log(process.exitCode ? "❌ Phase 7 gate FAILED" : "✅ Phase 7 gate PASSED");
  console.log("========================================================\n");
}

main().catch((err) => { console.error("Gate script threw error:", err); process.exit(1); }).finally(() => sql.end());
