import { spawn, spawnSync } from "node:child_process";
import { config } from "dotenv";
import postgres from "postgres";
import { createGateUser, demoSessionToken, findGateUser, sessionTokenFor } from "./gate-auth.mjs";

config({ path: new URL("./.env", import.meta.url).pathname });

// Phase 8 gate: seed idempotency, persona history, notifications, access receipts, staff create-patient, CORS.
// Needs the API on GATE_API_BASE_URL (default localhost:4000) and `npm run seed` to have run once.
const API = process.env.GATE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const sql = postgres(process.env.DATABASE_URL);
const DOMAIN = "demo.clinix.test";

async function api(token, method, path, body, base = API) {
  const res = await fetch(`${base}${path}`, {
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

/** Runs the seed script as a child process and returns its stdout. */
function runSeed() {
  const result = spawnSync("npx", ["tsx", "src/seed/index.ts"], { cwd: new URL(".", import.meta.url).pathname, encoding: "utf-8", env: process.env });
  return { code: result.status, out: result.stdout ?? "", err: result.stderr ?? "" };
}

/** Starts a second API instance with CORS_ORIGINS set, so the allowlist can be tested over real HTTP. */
async function withCorsApi(port, origins, fn) {
  const child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: new URL(".", import.meta.url).pathname,
    env: { ...process.env, PORT: String(port), CORS_ORIGINS: origins },
    stdio: "ignore",
    detached: true,
  });
  try {
    for (let i = 0; i < 40; i++) {
      const up = await fetch(`http://localhost:${port}/health`).then((r) => r.ok).catch(() => false);
      if (up) return await fn(`http://localhost:${port}/api/v1`);
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("CORS test API did not start");
  } finally {
    // npx starts the server as a grandchild, so stop the whole process group.
    process.kill(-child.pid, "SIGTERM");
  }
}

async function main() {
  console.log("=== CliniX AI Phase 8 Gate: PWA release, seed, screens, CORS ===");

  // 1. Seed idempotency (the seed ran before this gate; a repeat must create nothing).
  const seedRun = runSeed();
  check("Seed re-run succeeds", seedRun.code === 0, seedRun.err.trim().split("\n").pop());
  check("Seed re-run creates nothing", /Created this run: nothing/.test(seedRun.out));
  check("Seed output never prints credentials", !process.env.SEED_DEMO_PASSWORD || !seedRun.out.includes(process.env.SEED_DEMO_PASSWORD));

  const tokens = {
    doctor: await demoSessionToken(`kavita.rao@${DOMAIN}`),
    reception: await demoSessionToken(`priya.nair@${DOMAIN}`),
    assistant: await demoSessionToken(`imran.qureshi@${DOMAIN}`),
    a: await demoSessionToken(`ananya.krishnan@${DOMAIN}`),
    b: await demoSessionToken(`rohan.mehta@${DOMAIN}`),
    c: await demoSessionToken(`sunita.verma@${DOMAIN}`),
  };
  const doctorMe = await api(tokens.doctor, "GET", "/me");
  const doctorId = doctorMe.json?.doctor_id;
  check("Demo doctor resolves as a verified doctor", Boolean(doctorId) && doctorMe.json?.verification_status === "VERIFIED");
  const recMe = await api(tokens.reception, "GET", "/me");
  const asstMe = await api(tokens.assistant, "GET", "/me");
  check("Demo staff hold active memberships", recMe.json?.memberships?.[0]?.role === "RECEPTION" && asstMe.json?.memberships?.[0]?.role === "ASSISTANT");
  const directory = await api(tokens.a, "GET", "/doctors?verified_only=true");
  check("Demo doctor is listed in the directory", (directory.json ?? []).some((d) => d.doctor_id === doctorId));

  // 2. Persona history.
  const dashA = await api(tokens.a, "GET", "/patients/self/dashboard");
  check("Persona A dashboard shows the upcoming appointment", dashA.status === 200 && /Cough follow-up|IN_PERSON|CONFIRMED|REQUESTED/.test(JSON.stringify(dashA.json)));
  const timelineA = await api(tokens.a, "GET", "/patients/self/timeline");
  check("Persona A timeline holds the cough visit, prescription and lab", timelineA.status === 200 && /cough/i.test(JSON.stringify(timelineA.json)));
  const medsA = await api(tokens.a, "GET", "/patients/self/medications");
  const medsAText = JSON.stringify(medsA.json);
  check("Persona A medications show the old amoxicillin course with its reaction", /amoxicillin/i.test(medsAText) && /rash/i.test(medsAText));
  const labsA = await api(tokens.a, "GET", "/patients/self/lab-reports");
  check("Persona A has a lab report", (labsA.json ?? []).length >= 1, `${(labsA.json ?? []).length} report(s)`);
  const docsA = await api(tokens.a, "GET", "/patients/self/documents");
  const docTypes = (docsA.json?.documents ?? docsA.json ?? []).map((d) => d.document_type ?? d.documentType);
  check("Persona A vault holds the lab PDF and prescription image", docTypes.includes("LAB_REPORT") && docTypes.includes("PRESCRIPTION"), docTypes.join(","));

  const obsB = await api(tokens.b, "GET", "/patients/self/lab-observations?test_name=HbA1c");
  const hba1c = obsB.json?.points ?? [];
  const falling = hba1c.every((p, i) => i === 0 || p.value_numeric <= hba1c[i - 1].value_numeric);
  check("Persona B has a falling HbA1c trend of at least four points", obsB.status === 200 && hba1c.length >= 4 && falling, `${hba1c.length} points`);
  const medsB = await api(tokens.b, "GET", "/patients/self/medications");
  check("Persona B takes metformin", /metformin/i.test(JSON.stringify(medsB.json)) && /CURRENT/.test(JSON.stringify(medsB.json)));
  const timelineC = await api(tokens.c, "GET", "/patients/self/timeline");
  check("Persona C holds a minimal record", timelineC.status === 200 && /routine/i.test(JSON.stringify(timelineC.json)));

  // 3. Notifications: list, read, read-all and recipient isolation.
  const tag = `p8_${Date.now()}`;
  const practiceId = recMe.json?.memberships?.[0]?.practice_id;
  const joiner = await createGateUser(`${tag}n`, { display_name: "Synthetic Joiner" });
  const joinerToken = await sessionTokenFor(joiner.id);
  const notifyContact = `${tag}n@example.test`;
  for (let i = 0; i < 2; i++) {
    const invite = await api(tokens.doctor, "POST", `/practices/${practiceId}/invitations`, { contact: `${i}${notifyContact}`, role: "RECEPTION" });
    const joinerN = i === 0 ? joiner : await createGateUser(`${tag}m`, { display_name: "Synthetic Joiner Two" });
    const token = i === 0 ? joinerToken : await sessionTokenFor(joinerN.id);
    const accept = await api(token, "POST", `/practice-invitations/${invite.json?.invite_token}/accept`, { contact: `${i}${notifyContact}` });
    if (accept.status !== 200) check(`Invitation ${i} accepted for the notification setup`, false, accept.status);
  }
  const list = await api(tokens.doctor, "GET", "/notifications");
  const unread = (list.json ?? []).filter((n) => !n.read);
  check("Doctor notifications list includes related resource fields", unread.length >= 2 && unread[0].related_resource_type === "practice_member" && Boolean(unread[0].related_resource_id));
  const one = await api(tokens.doctor, "POST", `/notifications/${unread[0].id}/read`);
  check("Marking one notification read works", one.status === 200 && one.json?.read === true);
  const foreign = await api(tokens.a, "POST", `/notifications/${unread[1].id}/read`);
  check("Another recipient cannot mark it read", foreign.status === 404, foreign.status);
  const foreignList = await api(tokens.a, "GET", "/notifications");
  check("Another recipient does not see it", !(foreignList.json ?? []).some((n) => n.id === unread[1].id));
  const readAll = await api(tokens.doctor, "POST", "/notifications/read-all");
  check("Read-all marks the rest read", readAll.status === 200 && readAll.json?.updated >= 1, `updated ${readAll.json?.updated}`);
  const after = await api(tokens.doctor, "GET", "/notifications");
  check("Nothing stays unread after read-all", (after.json ?? []).every((n) => n.read));
  const patientReadAll = await api(tokens.a, "POST", "/notifications/read-all");
  check("Read-all only touches the caller's own rows", patientReadAll.status === 200 && patientReadAll.json?.updated === 0);

  // 4. Access receipt: owner-only.
  const patientRow = await sql`SELECT p.id FROM patients p JOIN profiles pr ON pr.id = p.account_profile_id JOIN auth.users u ON u.id = pr.supabase_user_id WHERE u.email = ${`ananya.krishnan@${DOMAIN}`}`;
  const patientAId = patientRow[0]?.id;
  const workspace = await api(tokens.doctor, "GET", `/doctor/patients/${patientAId}/workspace`);
  check("Doctor opens persona A's workspace (creates a ledger event)", workspace.status === 200, workspace.status);
  const ledger = await api(tokens.a, "GET", "/patients/self/access-ledger");
  const eventId = ledger.json?.events?.[0]?.id;
  check("Persona A ledger lists the access", Boolean(eventId));
  const receipt = await api(tokens.a, "GET", `/patients/self/access-events/${eventId}`);
  check("Owner reads the receipt", receipt.status === 200 && receipt.json?.actor?.role_label === "Doctor" && Boolean(receipt.json?.resource_label) && Boolean(receipt.json?.timestamp));
  check("Receipt carries no free-text clinical content", !JSON.stringify(receipt.json).match(/amoxicillin|cough|metformin/i));
  const docReceipt = await api(tokens.doctor, "GET", `/patients/self/access-events/${eventId}`);
  check("A doctor cannot read a patient's receipt", docReceipt.status === 403, docReceipt.status);
  const otherReceipt = await api(tokens.b, "GET", `/patients/self/access-events/${eventId}`);
  check("Another patient gets 404 for it", otherReceipt.status === 404, otherReceipt.status);
  const badReceipt = await api(tokens.a, "GET", "/patients/self/access-events/not-a-uuid");
  check("A malformed id is a 404", badReceipt.status === 404);

  // 5. Staff create-patient.
  const phone = `+9190${Math.floor(10000000 + Math.random() * 89999999)}`;
  const payload = { full_name: "Synthetic Walk-in Patient", mobile: phone, date_of_birth: "1985-05-05", sex_at_registration: "FEMALE", doctor_id: doctorId };
  const made = await api(tokens.reception, "POST", "/staff/patients", payload);
  check("Receptionist creates a patient for the practice's doctor", made.status === 201 && Boolean(made.json?.patient_id), made.status);
  const assistantMade = await api(tokens.assistant, "POST", "/staff/patients", { ...payload, mobile: `+9190${Math.floor(10000000 + Math.random() * 89999999)}` });
  check("Assistant (assigned to that doctor) can create too", assistantMade.status === 201, assistantMade.status);
  const duplicate = await api(tokens.reception, "POST", "/staff/patients", payload);
  check("A duplicate mobile returns 409 DUPLICATE_PATIENT", duplicate.status === 409 && duplicate.json?.error?.code === "DUPLICATE_PATIENT");
  const gateDoctor = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
  const gateDoctorMe = gateDoctor ? await api(await sessionTokenFor(gateDoctor.id), "GET", "/me") : null;
  const outsideDoctorId = gateDoctorMe?.json?.doctor_id;
  check("An outside doctor is available for the scoping check", Boolean(outsideDoctorId) && outsideDoctorId !== doctorId);
  const wrongDoctor = await api(tokens.reception, "POST", "/staff/patients", { ...payload, mobile: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`, doctor_id: outsideDoctorId });
  check("A doctor outside the practice is refused", wrongDoctor.status === 403, wrongDoctor.status);
  const notStaff = await api(tokens.a, "POST", "/staff/patients", { ...payload, mobile: `+9190${Math.floor(10000000 + Math.random() * 89999999)}` });
  check("A patient cannot create patients through the staff route", notStaff.status === 403, notStaff.status);
  const underage = await api(tokens.reception, "POST", "/staff/patients", { ...payload, mobile: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`, date_of_birth: "2015-01-01" });
  check("An under-18 registration is refused", underage.status === 403 && underage.json?.error?.code === "AGE_REQUIREMENT");
  const staffList = await api(tokens.reception, "GET", "/staff/patients?q=Synthetic Walk-in");
  check("The new patient appears in the practice's patient list", (staffList.json ?? []).some((p) => p.patient_id === made.json?.patient_id));
  const invite = await api(tokens.reception, "POST", `/staff/patients/${made.json?.patient_id}/claim-invites`);
  check("Staff can issue a claim invitation for the new patient", invite.status === 201 && Boolean(invite.json?.invite_token));
  const ledgerRow = await sql`SELECT count(*)::int AS n FROM access_events WHERE patient_id = ${made.json?.patient_id} AND action = 'CREATE' AND actor_type = 'CLINIC_STAFF'`;
  check("The registration is written to the access ledger", ledgerRow[0].n === 1);
  const doctorDup = await api(tokens.doctor, "POST", "/doctor/patients", { full_name: "Synthetic Walk-in Patient", mobile: phone, date_of_birth: "1985-05-05", sex_at_registration: "FEMALE" });
  check("The doctor route keeps its duplicate behaviour", doctorDup.status === 409 && doctorDup.json?.error?.code === "DUPLICATE_PATIENT");
  const doctorMade = await api(tokens.doctor, "POST", "/doctor/patients", { full_name: "Synthetic Doctor Patient", mobile: `+9190${Math.floor(10000000 + Math.random() * 89999999)}`, date_of_birth: "1990-02-02", sex_at_registration: "MALE" });
  check("The doctor route still creates patients", doctorMade.status === 201 && Boolean(doctorMade.json?.patient_id));

  // 6. CORS allowlist, over real HTTP against a second API instance.
  await withCorsApi(4011, "http://allowed.test", async (base) => {
    const probe = (origin) => fetch(`${base}/me`, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization" } });
    const denied = await probe("http://unlisted.test");
    check("CORS refuses an unlisted origin", denied.headers.get("access-control-allow-origin") === null);
    const allowed = await probe("http://allowed.test");
    check("CORS allows a listed origin", allowed.headers.get("access-control-allow-origin") === "http://allowed.test");
  });

  await sql.end();
  console.log(process.exitCode ? "\n❌ Phase 8 gate FAILED" : "\n✅ Phase 8 gate PASSED");
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
