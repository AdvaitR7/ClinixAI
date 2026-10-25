import { config } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { createGateUser } from "./gate-auth.mjs";

const envPath = new URL("./.env", import.meta.url);
config({ path: envPath, quiet: true });
const API = process.env.SUPABASE_GATE_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const sql = postgres(process.env.DATABASE_URL, { max: 3 });
let checks = 0;

/** Stops the gate on failure and reports only the check name, never credentials. */
function check(name, condition) {
  if (!condition) throw new Error(`FAIL ${name}`);
  checks += 1;
  console.log(`PASS ${name}`);
}

/** Sends a synthetic authenticated request through the real Fastify boundary. */
async function api(token, method, path, body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Creates a confirmed synthetic account and signs in using the official SDK. */
async function account(tag, metadata = {}) {
  const user = await createGateUser(`auth-${tag}`, { display_name: `Synthetic ${tag}`, ...metadata });
  const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: process.env.SUPABASE_GATE_PASSWORD });
  check(`${tag}: live Supabase sign-in`, !error && Boolean(data.session));
  return { user, client, token: data.session.access_token };
}

/** Returns adult synthetic onboarding data with a deliberately non-contact phone. */
function patientBody() {
  return { full_name: "Synthetic Auth Patient", phone: `+91000${randomInt(1000000, 9999999)}`, date_of_birth: "1990-01-01", sex_at_registration: "female", role: "ADMIN" };
}

/** Configures the existing clinical gates to use only these fresh synthetic users. */
function configureClinicalGates(doctor, patient) {
  let text = readFileSync(envPath, "utf8");
  for (const [name, value] of Object.entries({ SUPABASE_GATE_DOCTOR_EMAIL: doctor.user.email, SUPABASE_GATE_PATIENT_EMAIL: patient.user.email })) {
    const pattern = new RegExp(`^${name}=.*$`, "m");
    text = pattern.test(text) ? text.replace(pattern, `${name}=${value}`) : `${text.trimEnd()}\n${name}=${value}\n`;
  }
  writeFileSync(envPath, text, { mode: 0o600 });
}

/** Runs live auth, onboarding, ownership, role, concurrency, and browser-grant gates. */
async function main() {
  check("missing bearer rejected", (await api(null, "GET", "/me")).status === 401);
  check("malformed bearer rejected", (await api("not-a-token", "GET", "/me")).status === 401);
  check("anon API key is not a user session", (await api(process.env.SUPABASE_ANON_KEY, "GET", "/me")).status === 401);
  check("service-role API key is not a user session", (await api(process.env.SUPABASE_SERVICE_ROLE_KEY, "GET", "/me")).status === 401);

  const doctor = await account("doctor", { role: "ADMIN", primary_role: "CLINIC_STAFF" });
  const missing = await api(doctor.token, "GET", "/me");
  check("verified identity without profile requires onboarding", missing.status === 403 && missing.body?.error?.code === "ONBOARDING_REQUIRED");
  const doctorPayload = { registration_number: `SYNTHETIC-${Date.now()}`, registration_authority: "Synthetic test authority", role: "ADMIN" };
  const doctors = await Promise.all([api(doctor.token, "POST", "/doctors/self", doctorPayload), api(doctor.token, "POST", "/doctors/self", doctorPayload)]);
  check("concurrent doctor onboarding is idempotent", doctors.every((r) => [200, 201].includes(r.status)) && new Set(doctors.map((r) => r.body.doctor_id)).size === 1);
  const doctorId = doctors[0].body.doctor_id;
  const doctorMe = await api(doctor.token, "GET", "/me");
  check("database doctor role overrides privileged metadata", doctorMe.body?.role === "DOCTOR" && doctorMe.body?.verification_status === "PENDING");

  const patient = await account("patient", { role: "CLINIC_STAFF" });
  const payload = patientBody();
  const patients = await Promise.all(Array.from({ length: 3 }, () => api(patient.token, "POST", "/patients/self", payload)));
  check("concurrent patient onboarding returns one internal record", patients.every((r) => [200, 201].includes(r.status)) && new Set(patients.map((r) => r.body.patient_id)).size === 1);
  const patientId = patients[0].body.patient_id;
  const patientMe = await api(patient.token, "GET", "/me");
  check("staff/admin metadata cannot grant a privileged application role", patientMe.body?.role === "PATIENT");
  const [patientCount] = await sql`select count(*)::int as total from patients p join profiles f on f.id=p.account_profile_id where f.supabase_user_id=${patient.user.id}`;
  check("one patient row exists after concurrent onboarding", patientCount.total === 1);
  check("onboarding cannot convert patient into doctor", (await api(patient.token, "POST", "/doctors/self", doctorPayload)).status === 409);
  check("patient cannot enter doctor-only API", (await api(patient.token, "GET", "/doctor/patients")).status === 403);

  const other = await account("unrelated-doctor");
  const otherOnboarding = await api(other.token, "POST", "/doctors/self", { ...doctorPayload, registration_number: `OTHER-${Date.now()}` });
  check("unrelated doctor onboarded", otherOnboarding.status === 201);
  check("doctor denied without patient relationship", (await api(doctor.token, "GET", `/doctor/patients/${patientId}/workspace`)).status === 403);
  check("patient can establish doctor relationship", (await api(patient.token, "POST", `/patients/self/doctors/${doctorId}/relationships`, { relationship_type: "PRIMARY_PHYSICIAN", preferred: true })).status === 200);
  check("active doctor relationship permits access", (await api(doctor.token, "GET", `/doctor/patients/${patientId}/workspace`)).status === 200);
  check("another doctor cannot cross the relationship boundary", (await api(other.token, "GET", `/doctor/patients/${patientId}/workspace`)).status === 403);
  await sql`update patient_doctor_relationships set status='ENDED',ended_at=now() where patient_id=${patientId} and doctor_id=${doctorId}`;
  check("ended relationship denies access", (await api(doctor.token, "GET", `/doctor/patients/${patientId}/workspace`)).status === 403);
  await sql`update patient_doctor_relationships set status='ACTIVE',ended_at=null where patient_id=${patientId} and doctor_id=${doctorId}`;

  const claimant = await account("claimant");
  const invites = [];
  for (let i = 0; i < 2; i += 1) {
    const created = await api(doctor.token, "POST", "/doctor/patients", { full_name: `Synthetic claim race ${i}`, mobile: patientBody().phone, date_of_birth: "1990-01-01", sex_at_registration: "female" });
    check(`synthetic claim record ${i} created`, created.status === 201);
    const invite = await api(doctor.token, "POST", `/doctor/patients/${created.body.patient_id}/claim-invites`, {});
    check(`synthetic claim invite ${i} created`, invite.status === 201);
    invites.push(invite.body.invite_token);
  }
  const claims = await Promise.all(invites.map((invite_token) => api(claimant.token, "POST", "/patient-claims", { invite_token })));
  check("concurrent distinct claims yield one success and one conflict", claims.filter((r) => r.status === 200).length === 1 && claims.filter((r) => r.status === 409).length === 1);
  const winner = claims.findIndex((r) => r.status === 200);
  const repeated = await api(claimant.token, "POST", "/patient-claims", { invite_token: invites[winner] });
  check("successful claim is idempotent and retains internal patient ID", repeated.status === 200 && repeated.body.patient_id === claims[winner].body.patient_id);
  check("doctor cannot convert role using a patient claim", (await api(doctor.token, "POST", "/patient-claims", { invite_token: invites[0] })).status === 409);

  const upload = await api(patient.token, "POST", "/patients/self/documents/upload-init", { filename: "auth-synthetic.pdf", mime_type: "application/pdf", document_type: "LAB_REPORT" });
  check("signed Storage upload initialized", upload.status === 201);
  const put = await fetch(upload.body.upload_url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: readFileSync(new URL("./fixtures/lab_synthetic.pdf", import.meta.url)) });
  check("signed Storage upload succeeds", put.ok);
  check("document owner can view their source", (await api(patient.token, "GET", `/patients/self/documents/${upload.body.document_id}`)).status === 200);
  check("another patient cannot view private document", (await api(claimant.token, "GET", `/patients/self/documents/${upload.body.document_id}`)).status === 404);

  const tables = await sql`select tablename from pg_tables where schemaname='public'`;
  const publicKey = process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  for (const [label, token] of [["anon", null], ["authenticated", patient.token]]) {
    const denied = await Promise.all(tables.map(async ({ tablename }) => {
      const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${tablename}?select=*&limit=0`, { headers: { apikey: publicKey, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, method: "HEAD" });
      return [401, 403, 404].includes(response.status);
    }));
    check(`${label}: direct Data API denied for all ${tables.length} clinical tables`, denied.every(Boolean));
  }
  const refreshed = await patient.client.auth.refreshSession();
  check("SDK refresh produces an API-accepted session", !refreshed.error && (await api(refreshed.data.session.access_token, "GET", "/me")).status === 200);
  await patient.client.auth.signOut();
  check("SDK sign-out clears its local session", !(await patient.client.auth.getSession()).data.session);
  const [legacyLinked] = await sql`select count(*)::int as total from profiles where legacy_auth_subject is not null and supabase_user_id is not null`;
  check("no legacy account was automatically linked", legacyLinked.total === 0);
  configureClinicalGates(doctor, patient);
  console.log(`Live Supabase auth gate: ${checks} checks passed. Synthetic records retained.`);
}

try { await main(); }
catch (cause) { console.error(cause instanceof Error ? cause.message : "Supabase auth gate failed"); process.exitCode = 1; }
finally { await sql.end({ timeout: 2 }); }
