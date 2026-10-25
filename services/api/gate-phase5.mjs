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
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json };
}

function check(name, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  → ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollAiSession(token, sessionId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await api(token, "GET", `/ai-sessions/${sessionId}`);
    const s = res.json?.status;
    if (s === "SUCCEEDED" || s === "FAILED" || s === "BLOCKED") return res.json;
    await sleep(2000);
  }
  return null;
}

async function main() {
  console.log("=== CliniX AI Phase 5 Gate: AI Check-in & Test Milestone B ===");

  // 1. Resolve Doctor User (doctor_test@example.com)
  const doctorUser = await findGateUser(process.env.SUPABASE_GATE_DOCTOR_EMAIL);
  check("Configured Supabase doctor account exists", Boolean(doctorUser), doctorUser?.id);
  if (!doctorUser) throw new Error("Configure SUPABASE_GATE_DOCTOR_EMAIL in services/api/.env");
  const doctorToken = await sessionTokenFor(doctorUser.id);

  const meDoc = await api(doctorToken, "GET", "/me");
  check("Doctor /me returns DOCTOR role", meDoc.json?.role === "DOCTOR");
  const doctorId = meDoc.json?.doctor_id;
  check("Doctor profile has ID", Boolean(doctorId), doctorId);

  // 2. Create Ephemeral Patient for Phase 5 (Persona A - Maya Rao)
  const tag = `p5_${Date.now()}`;
  const supabasePatient = await createGateUser(tag, { display_name: "Maya Rao" });
  check("Synthetic Supabase patient created", Boolean(supabasePatient.id), supabasePatient.id);
  const patientToken = await sessionTokenFor(supabasePatient.id);

  // Patient onboarding (18+ adult DOB, 1992-06-12)
  const onbRes = await api(patientToken, "POST", "/patients/self", {
    full_name: "Maya Rao",
    phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
    date_of_birth: "1992-06-12",
    sex_at_registration: "FEMALE",
  });
  check("Patient onboarding complete", onbRes.status === 201, onbRes.json?.patient_id);
  const patientId = onbRes.json?.patient_id;

  const mePat = await api(patientToken, "GET", "/me");
  check("Patient /me returns PATIENT role", mePat.json?.role === "PATIENT");

  // Create relationship between patient and doctor so doctor has authorized access
  const relRes = await api(patientToken, "POST", `/patients/self/doctors/${doctorId}/relationships`, {
    relationship_type: "PRIMARY_PHYSICIAN",
    preferred: true,
  });
  check("Patient linked regular doctor relationship", relRes.status === 200);

  // 3. Seed Persona A historical clinical data:
  // Historical bronchitis/cough encounter + Amoxicillin prescription
  const histEncRes = await api(doctorToken, "POST", "/doctor/encounters", {
    patient_id: patientId,
    encounter_type: "DOCTOR_IN_PERSON",
  });
  check("Doctor created historical encounter", histEncRes.status === 201, histEncRes.json?.encounter_id);
  const histEncId = histEncRes.json?.encounter_id;

  // Set historical encounter concern and close it
  await sql`
    UPDATE encounters
    SET chief_concern = 'Acute bronchitis with persistent cough',
        status = 'COMPLETED',
        started_at = NOW() - INTERVAL '3 months'
    WHERE id = ${histEncId}
  `;

  // Create & finalize historical prescription (Amoxicillin)
  const draftRes = await api(doctorToken, "POST", `/doctor/encounters/${histEncId}/prescription-drafts`, {
    source: "DIRECT_ENTRY",
    items: [
      {
        medicine_name: "Amoxicillin",
        strength: "500 mg",
        dose: "1 capsule",
        route: "ORAL",
        frequency: "Three times daily",
        timing: "AFTER_FOOD",
        duration: "5 days",
        instructions: "Complete full course",
      },
    ],
  });
  check("Historical prescription draft created", draftRes.status === 201 && Boolean(draftRes.json?.id), draftRes.json?.id);
  const histDraftId = draftRes.json?.id;

  const finRes = await api(
    doctorToken,
    "POST",
    `/doctor/prescription-drafts/${histDraftId}/finalize`,
    {},
    { "Idempotency-Key": `fin-hist-${tag}` },
  );
  check("Historical prescription finalized (Version 1)", finRes.status === 201 && Boolean(finRes.json?.id), finRes.json?.id);

  // 4. TEST EMERGENCY INTERRUPT NEGATIVE TEST (emergency.json rule engine)
  console.log("\n--- Testing Red-Flag Safety Interrupt Flow (Screen 6a) ---");
  const emergEncRes = await api(patientToken, "POST", "/patients/self/encounters", {
    encounter_type: "AI_SELF_CARE",
    chief_concern: "Severe chest pain",
  });
  const emergEncId = emergEncRes.json?.encounter_id;

  const emergStart = await api(patientToken, "POST", `/encounters/${emergEncId}/interaction/start`, {
    chief_concern: "Crushing chest pain radiating to left arm and unable to breathe",
  });

  check(
    "Emergency symptoms trigger SAFETY_ESCALATION",
    emergStart.json?.status === "SAFETY_ESCALATION",
    emergStart.json?.status,
  );
  check(
    "Safety alert action is BLOCK_NORMAL_FLOW",
    emergStart.json?.safety_alert?.action === "BLOCK_NORMAL_FLOW",
    emergStart.json?.safety_alert?.action,
  );
  check(
    "Safety alert severity is CRITICAL",
    emergStart.json?.safety_alert?.severity === "CRITICAL",
    emergStart.json?.safety_alert?.severity,
  );
  check(
    "Safety alert includes emergency helpline (112)",
    emergStart.json?.safety_alert?.emergency_number?.includes("112"),
    emergStart.json?.safety_alert?.emergency_number,
  );

  const [safetyLog] = await sql`
    SELECT stage, severity, action
    FROM safety_evaluations
    WHERE encounter_id = ${emergEncId}
  `;
  check("safety_evaluations table logged PRE_AI critical evaluation", safetyLog?.severity === "CRITICAL");

  // 5. TEST ADAPTIVE CHECK-IN HAPPY PATH (Screen 6)
  console.log("\n--- Testing Adaptive Health Check-in Flow (Screen 6) ---");
  const checkinEncRes = await api(patientToken, "POST", "/patients/self/encounters", {
    encounter_type: "AI_SELF_CARE",
    chief_concern: "Recurring dry cough for 4 days",
  });
  check("New check-in encounter created", checkinEncRes.status === 201, checkinEncRes.json?.encounter_id);
  const checkinEncId = checkinEncRes.json?.encounter_id;

  // Step 1: Start adaptive questioning
  const step1 = await api(patientToken, "POST", `/encounters/${checkinEncId}/interaction/start`, {
    chief_concern: "Recurring dry cough for 4 days",
  });
  check("Check-in session started", step1.status === 200);
  check("Step 1 returns NEEDS_MORE_INFORMATION", step1.json?.status === "NEEDS_MORE_INFORMATION");
  check("Step 1 returns question block", Boolean(step1.json?.next_block?.title), step1.json?.next_block?.title);
  const sessionId = step1.json?.interaction_session_id;
  const block1Id = step1.json?.next_block?.id;

  // Step 2: Answer Duration
  const step2 = await api(patientToken, "POST", `/interactions/${sessionId}/responses`, {
    block_id: block1Id,
    selected_option_ids: ["4_7d"],
  });
  check("Response 1 submitted", step2.status === 200);
  check("Step 2 returns severity question", step2.json?.status === "NEEDS_MORE_INFORMATION");
  const block2Id = step2.json?.next_block?.id;

  // Step 3: Answer Severity
  const step3 = await api(patientToken, "POST", `/interactions/${sessionId}/responses`, {
    block_id: block2Id,
    selected_option_ids: ["moderate"],
  });
  check("Response 2 submitted", step3.status === 200);
  check("Step 3 returns associated symptoms", step3.json?.status === "NEEDS_MORE_INFORMATION");
  const block3Id = step3.json?.next_block?.id;

  // Step 4: Answer Associated Symptoms -> Transitions to READY_FOR_ANALYSIS
  const step4 = await api(patientToken, "POST", `/interactions/${sessionId}/responses`, {
    block_id: block3Id,
    selected_option_ids: ["sore_throat"],
  });
  check("Response 3 submitted", step4.status === 200);
  check("Check-in completes with READY_FOR_ANALYSIS", step4.json?.status === "READY_FOR_ANALYSIS");

  const [sessionRow] = await sql`
    SELECT status, current_step FROM interaction_sessions WHERE id = ${sessionId}
  `;
  check("interaction_sessions marked COMPLETED in database", sessionRow?.status === "COMPLETED");

  // 6. TEST AI CONSENSUS ANALYSIS (9Router Dual-Analyst + Judge Pipeline)
  console.log("\n--- Testing 9Router Multi-Analyst + Judge Consensus Pipeline ---");
  const aiTrigger = await api(patientToken, "POST", `/encounters/${checkinEncId}/ai-analysis`);
  check("POST /ai-analysis returns 202 Accepted", aiTrigger.status === 202, aiTrigger.json?.ai_session_id);
  const aiSessionId = aiTrigger.json?.ai_session_id;

  // The separate worker must consume the real queued job. Directly importing
  // its TypeScript handler both bypasses that boundary and can run the job twice.
  const aiResult = await pollAiSession(patientToken, aiSessionId);
  check("AI session transitioned to SUCCEEDED", aiResult?.status === "SUCCEEDED", aiResult?.status);

  // Verify Patient-Safe Outcome (Screen 7 contract)
  const outcome = aiResult?.outcome;
  check("Outcome contains non-diagnostic summary", Boolean(outcome?.summary), outcome?.summary);
  check("Outcome contains low-risk guidance list", outcome?.low_risk_guidance?.length > 0);
  check("Outcome contains statutory non-reuse warning", Boolean(outcome?.statutory_warning));
  check(
    "Statutory warning emphasizes prior treatment is not authorization for reuse",
    outcome?.statutory_warning?.includes("Prior treatment is not authorization for reuse"),
  );

  // Check Historical Episode Match (Persona A cough match)
  const matches = outcome?.historical_matches ?? [];
  check("Outcome includes historical episode match", matches.length > 0, `Matches: ${matches.length}`);
  const coughMatch = matches.find((m) => m.similarity_label === "STRONGLY_SIMILAR" || m.chief_concern?.includes("cough"));
  check("Historical match classified as STRONGLY_SIMILAR or cough episode", Boolean(coughMatch), coughMatch?.similarity_label);

  // Verify Evidence Citations
  const evidenceRes = await api(patientToken, "GET", `/ai-sessions/${aiSessionId}/evidence`);
  check("GET /ai-sessions/:id/evidence returns source citations", evidenceRes.json?.sources?.length > 0);

  // Direct SQL Invariant Assertions
  const [bundleRow] = await sql`
    SELECT contains_direct_identifiers, payload_hash
    FROM ai_evidence_bundles
    WHERE ai_session_id = ${aiSessionId}
  `;
  check("ai_evidence_bundles enforces contains_direct_identifiers = false", bundleRow?.contains_direct_identifiers === false);

  const modelRuns = await sql`
    SELECT role, provider_route, status
    FROM ai_model_runs
    WHERE ai_session_id = ${aiSessionId}
  `;
  check("ai_model_runs recorded at least 3 models (Analyst 1, Analyst 2, Judge)", modelRuns.length >= 3, `Count: ${modelRuns.length}`);

  const roles = modelRuns.map((r) => r.role);
  check("ANALYST_1 recorded in model runs", roles.includes("ANALYST_1"));
  check("ANALYST_2 recorded in model runs", roles.includes("ANALYST_2"));
  check("JUDGE recorded in model runs", roles.includes("JUDGE"));

  const [judgmentRow] = await sql`
    SELECT agreements, safe_consensus, requires_doctor_review
    FROM ai_judgments
    WHERE ai_session_id = ${aiSessionId}
  `;
  check("ai_judgments consensus record stored", Boolean(judgmentRow?.safe_consensus));

  const [aiAccessLog] = await sql`
    SELECT actor_type, action
    FROM access_events
    WHERE resource_id = ${aiSessionId} AND action = 'AI_PROCESS'
  `;
  check("access_events audit ledger recorded AI_SERVICE:AI_PROCESS", Boolean(aiAccessLog));

  // 7. TEST PATIENT LONGITUDINAL TIMELINE (Screen 8)
  console.log("\n--- Testing Patient Health Timeline (Screen 8) ---");
  const timelineRes = await api(patientToken, "GET", "/patients/self/timeline");
  check("GET /patients/self/timeline returns 200", timelineRes.status === 200);
  const entries = timelineRes.json?.entries ?? [];
  check("Timeline has multiple chronological entries", entries.length >= 2, `Count: ${entries.length}`);

  const aiTimelineEntry = entries.find((e) => e.is_ai_derived === true);
  check("Timeline includes entry with is_ai_derived = true", Boolean(aiTimelineEntry), aiTimelineEntry?.title);
  check("AI entry provenance is AI_DERIVED", aiTimelineEntry?.provenance === "AI_DERIVED");

  const filterRes = await api(patientToken, "GET", "/patients/self/timeline?filter=AI_CHECKINS");
  check("Timeline filter ?filter=AI_CHECKINS works", filterRes.json?.entries?.every((e) => e.type === "AI_CHECKIN"));

  // 8. TEST CONSULTATION BOOKING WITH PACKET
  console.log("\n--- Testing Booking with Packet Attached ---");
  const bookRes = await api(patientToken, "POST", "/patients/self/appointments", {
    doctor_id: doctorId,
    appointment_type: "ONLINE",
    scheduled_start: new Date(Date.now() + 86400000).toISOString(),
    reason: `Attached packet from check-in ${sessionId}`,
  });
  check("Patient booked appointment with packet attached", bookRes.status === 201, bookRes.json?.appointment_id);
  const apptId = bookRes.json?.appointment_id;

  // 9. TEST DOCTOR CLINICAL WORKSPACE SPLIT RECORD (Screen 17)
  console.log("\n--- Testing Doctor Split Clinical Workspace (Screen 17) ---");
  const workspaceRes = await api(doctorToken, "GET", `/doctor/patients/${patientId}/workspace`);
  check("Doctor accessed patient workspace", workspaceRes.status === 200);
  check("Workspace returns factual patient identity", workspaceRes.json?.identity?.full_name === "Maya Rao");
  check("Workspace returns masked phone number", Boolean(workspaceRes.json?.identity?.phone_last4));

  const docAiRes = await api(doctorToken, "GET", `/doctor/encounters/${checkinEncId}/ai-assistance`);
  check("Doctor retrieved AI assistance view", docAiRes.status === 200);
  check("AI assistance provides agreements", docAiRes.json?.agreements?.length > 0);
  check("AI assistance provides questions to ask patient", docAiRes.json?.questions_to_ask_patient?.length > 0);
  check("AI assistance includes consent-locked sections", docAiRes.json?.consent_locked_sections?.length > 0);

  // Verify access_events audit row for doctor view
  const [docAccessLog] = await sql`
    SELECT actor_type, action
    FROM access_events
    WHERE patient_id = ${patientId} AND action = 'VIEW' AND actor_type = 'DOCTOR'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  check("access_events audit ledger recorded DOCTOR:VIEW", Boolean(docAccessLog));

  // Keep synthetic account rows intact so the gate never deletes auth or clinical data.

  console.log("\n========================================================");
  console.log(process.exitCode ? "❌ Test Milestone B FAILED" : "✅ Test Milestone B PASSED (All checks green)");
  console.log("========================================================\n");
}

main().catch((err) => {
  console.error("Gate script threw error:", err);
  process.exit(1);
}).finally(() => {
  sql.end();
});
