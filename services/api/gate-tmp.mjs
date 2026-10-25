import { config } from "dotenv";
import { createGateUser, findGateUser, sessionTokenFor } from "./gate-auth.mjs";

config({ path: new URL("./.env", import.meta.url).pathname });

const API = "http://localhost:4000/api/v1";


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

const doctorUser = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
const patientUser = await findGateUser(process.env.SUPABASE_GATE_PATIENT_EMAIL);

if (!doctorUser || !patientUser) {
  console.log("Configure SUPABASE_GATE_DOCTOR_EMAIL and SUPABASE_GATE_PATIENT_EMAIL in services/api/.env");
  process.exit(1);
}

const doctorToken = await sessionTokenFor(doctorUser.id);
const patientToken = await sessionTokenFor(patientUser.id);

const doctorMe = await api(doctorToken, "GET", "/me");
const patientMe = await api(patientToken, "GET", "/me");
check("doctor /me role", doctorMe.json?.role === "DOCTOR", doctorMe.json?.role);
check("patient /me role", patientMe.json?.role === "PATIENT", patientMe.json?.role);

const doctorId = doctorMe.json?.doctor_id;

// 1. Doctor sets availability (all days 09:00-17:00, 30-min slots)
const avail = await api(doctorToken, "PUT", "/doctors/self/availability", {
  template: [0, 1, 2, 3, 4, 5, 6].map((day_of_week) => ({
    day_of_week, start_time: "09:00", end_time: "17:00",
  })),
  slot_duration_minutes: 30,
});
check("doctor sets availability", avail.status === 200, avail.status);

const ymd = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);

// 2. Doctor creates unclaimed patient
const mobile = `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`;
const createP = await api(doctorToken, "POST", "/doctor/patients", {
  full_name: "Synthetic Unclaimed", mobile, date_of_birth: "1990-01-01", sex_at_registration: "female",
});
check("create unclaimed patient 201", createP.status === 201, createP.status);
const newPatientId = createP.json?.patient_id;

const dupP = await api(doctorToken, "POST", "/doctor/patients", {
  full_name: "Synthetic Unclaimed", mobile, date_of_birth: "1990-01-01", sex_at_registration: "female",
});
check("duplicate phone → 409 DUPLICATE_PATIENT", dupP.status === 409 && dupP.json?.error?.code === "DUPLICATE_PATIENT", dupP.json?.error?.code);

const dir = await api(doctorToken, "GET", `/doctor/patients?filter=unclaimed`);
check("directory lists unclaimed patient", dir.json?.some((p) => p.patient_id === newPatientId), `count=${dir.json?.length}`);

// 3. Patient lists doctors + preferred relationship
const docs = await api(patientToken, "GET", "/doctors");
check("patient lists doctors", Array.isArray(docs.json) && docs.json.some((d) => d.doctor_id === doctorId), docs.status);
const rel = await api(patientToken, "POST", `/patients/self/doctors/${doctorId}/relationships`, {
  relationship_type: "PRIMARY_PHYSICIAN", preferred: true,
});
check("patient creates relationship", rel.status === 200, rel.status);

// 4. Availability + book
const slotsRes = await api(patientToken, "GET", `/doctors/${doctorId}/availability?from=${ymd}&to=${ymd}`);
const slot = slotsRes.json?.slots?.[0];
check("availability returns slots", Array.isArray(slotsRes.json?.slots) && slotsRes.json.slots.length > 0, `count=${slotsRes.json?.slots?.length}`);
if (!slot) { console.log("NO SLOT"); process.exit(1); }

const book = await api(patientToken, "POST", "/patients/self/appointments", {
  doctor_id: doctorId, appointment_type: "IN_PERSON", scheduled_start: slot.start, reason: "Recurring cough",
});
check("book appointment → REQUESTED", book.status === 201 && book.json?.appointment?.status === "REQUESTED", book.json?.appointment?.status);
const apptId = book.json?.appointment?.id;

// 4b. Second patient tries the same slot → 409 SLOT_TAKEN
const p2 = await createGateUser("p2");
const p2token = await sessionTokenFor(p2.id);
await api(p2token, "POST", "/patients/self", {
  full_name: "Second Patient", phone: `+91${Math.floor(1000000000 + Math.random() * 8999999999)}`,
  date_of_birth: "1992-02-02", sex_at_registration: "male",
});
const p2book = await api(p2token, "POST", "/patients/self/appointments", {
  doctor_id: doctorId, appointment_type: "IN_PERSON", scheduled_start: slot.start,
});
check("second patient same slot → 409 SLOT_TAKEN", p2book.status === 409 && p2book.json?.error?.code === "SLOT_TAKEN", p2book.json?.error?.code);

// 5. Doctor dashboard lists request
const dash = await api(doctorToken, "GET", "/doctor/dashboard");
check("doctor dashboard lists incoming request", dash.json?.incoming_requests?.some((a) => a.id === apptId), dash.status);

// 6. Confirm (send {} body like the web app)
const confirm = await api(doctorToken, "POST", `/doctor/appointments/${apptId}/confirm`, {});
check("confirm → 200", confirm.status === 200, confirm.status);

// 7. Schedule list shows confirmed
const sched = await api(doctorToken, "GET", `/doctor/appointments?from=${ymd}&to=${ymd}`);
check("schedule lists confirmed appointment", sched.json?.some((a) => a.id === apptId && a.status === "CONFIRMED"), sched.status);

// 8. Workspace dossier
const ws = await api(doctorToken, "GET", `/doctor/patients/${newPatientId}/workspace`);
check("workspace dossier 200", ws.status === 200, ws.status);
check("workspace identity + no blob leak", ws.json?.identity?.full_name === "Synthetic Unclaimed" && !("full_name_encrypted" in (ws.json?.identity ?? {})), ws.json?.identity?.full_name);

// 9. Patient dashboard (earliest upcoming; prior runs left earlier synthetic slots)
const pdash = await api(patientToken, "GET", "/patients/self/dashboard");
const up = pdash.json?.upcoming_appointment;
check("patient dashboard upcoming appointment", !!up && up.doctor_id === doctorId && ["REQUESTED", "CONFIRMED"].includes(up.status), up ? `${up.status} @ ${up.scheduled_start}` : "null");

// 10. Cancel path (patient cancels a second booking)
const book2 = await api(patientToken, "POST", "/patients/self/appointments", {
  doctor_id: doctorId, appointment_type: "IN_PERSON", scheduled_start: slotsRes.json.slots[1].start,
});
const cancel = await api(patientToken, "POST", `/appointments/${book2.json.appointment.id}/cancel`, {});
check("cancel → 200", cancel.status === 200, cancel.status);

console.log("\nDONE");
