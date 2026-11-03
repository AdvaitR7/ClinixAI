import { config } from "dotenv";
import postgres from "postgres";
import { demoSessionToken } from "./gate-auth.mjs";

config({ path: new URL("./.env", import.meta.url).pathname });

// Scripted check-in for the milestone rehearsal and for recording demo replays.
// Usage: node demo-checkin.mjs a|b|c   (needs the API, the worker and `npm run seed`)
const API = process.env.GATE_API_BASE_URL ?? "http://localhost:4000/api/v1";
const DOMAIN = "demo.clinix.test";

/** Exact scripted answers; replay keys derive from these, so they must not drift between runs. */
const SCRIPTS = {
  a: { email: `ananya.krishnan@${DOMAIN}`, concern: "Recurring dry cough for 4 days", answers: ["4_7d", "moderate", "sore_throat"] },
  b: { email: `rohan.mehta@${DOMAIN}`, concern: "Increased thirst and tiredness for two weeks", answers: ["gt_1w", "mild", "fatigue"] },
  c: { email: `sunita.verma@${DOMAIN}`, concern: "Crushing chest pain radiating to left arm and unable to breathe", answers: [] },
};

async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const key = process.argv[2]?.toLowerCase();
  const script = SCRIPTS[key];
  if (!script) throw new Error("Usage: node demo-checkin.mjs a|b|c");
  const token = await demoSessionToken(script.email);

  const enc = await api(token, "POST", "/patients/self/encounters", { encounter_type: "AI_SELF_CARE", chief_concern: script.concern });
  const encounterId = enc.json?.encounter_id;
  let step = await api(token, "POST", `/encounters/${encounterId}/interaction/start`, { chief_concern: script.concern });

  if (step.json?.status === "SAFETY_ESCALATION") {
    console.log(`persona ${key}: SAFETY_ESCALATION (${step.json.safety_alert?.action}, ${step.json.safety_alert?.severity}); AI analysis blocked, as designed`);
    return;
  }
  const sessionId = step.json?.interaction_session_id;
  for (const optionId of script.answers) {
    step = await api(token, "POST", `/interactions/${sessionId}/responses`, { block_id: step.json?.next_block?.id, selected_option_ids: [optionId] });
  }
  if (step.json?.status !== "READY_FOR_ANALYSIS") throw new Error(`Check-in did not reach READY_FOR_ANALYSIS (${step.json?.status})`);

  const trigger = await api(token, "POST", `/encounters/${encounterId}/ai-analysis`);
  const aiSessionId = trigger.json?.ai_session_id;
  let result = null;
  for (let i = 0; i < 90; i++) {
    const poll = await api(token, "GET", `/ai-sessions/${aiSessionId}`);
    if (["SUCCEEDED", "FAILED", "BLOCKED"].includes(poll.json?.status)) { result = poll.json; break; }
    await sleep(2000);
  }
  if (!result) throw new Error("AI analysis timed out; is the worker running?");

  const sql = postgres(process.env.DATABASE_URL);
  const runs = await sql`SELECT role, provider_route FROM ai_model_runs WHERE ai_session_id = ${aiSessionId} ORDER BY role`;
  await sql.end();
  console.log(`persona ${key}: ${result.status}; draft-first: ${result.outcome?.requires_doctor_review === true ? "doctor review required" : "outcome is patient-safe guidance only"}`);
  console.log(`  summary: ${result.outcome?.summary ?? "(none)"}`);
  console.log(`  historical matches: ${(result.outcome?.historical_matches ?? []).length}`);
  console.log(`  routes: ${runs.map((r) => `${r.role}=${r.provider_route}`).join(", ")}`);
}

main().catch((cause) => { console.error(cause instanceof Error ? cause.message : cause); process.exit(1); });
