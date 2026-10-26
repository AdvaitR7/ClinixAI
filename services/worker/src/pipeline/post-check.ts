import {
  STATUTORY_NON_REUSE_WARNING,
  type HistoricalEpisodeMatch,
  type JudgeOutput,
  type PatientCheckinOutcome,
} from "@clinix/schemas";
import type { CanonicalEvidenceBundle } from "./evidence-bundle.js";

const COMMON_RX_DRUGS = [
  "amoxicillin",
  "azithromycin",
  "ciprofloxacin",
  "doxycycline",
  "cephalexin",
  "metformin",
  "atorvastatin",
  "lisinopril",
  "amlodipine",
  "prednisone",
  "albuterol",
  "hydrochlorothiazide",
];

/**
 * Deterministic post-check on Judge output.
 * Ensures strict patient-safe presentation:
 * - Filters out prescription medication names from self-care guidance.
 * - Resolves historical episode matches against the Evidence Bundle.
 * - Formats patient-facing guidance with mandatory non-reuse warning.
 */
export function buildPatientSafeOutcome(
  evidence: CanonicalEvidenceBundle,
  judgment: JudgeOutput,
  analystMatches: Array<{
    encounter_id: string;
    similarity_label:
      | "STRONGLY_SIMILAR"
      | "PARTIALLY_SIMILAR"
      | "INSUFFICIENTLY_SIMILAR";
    supporting_features: string[];
    differences: string[];
  }>,
): {
  outcome: PatientCheckinOutcome;
  historicalMatches: HistoricalEpisodeMatch[];
} {
  // 1. Sanitize guidance: strip unauthorized prescription drug mentions
  const sanitizedGuidance: string[] = [];
  for (const item of judgment.safe_consensus) {
    const lower = item.toLowerCase();
    const hasRx = COMMON_RX_DRUGS.some((drug) => lower.includes(drug));
    if (!hasRx) {
      sanitizedGuidance.push(item);
    }
  }

  // 2. Resolve historical matches against past encounters in the bundle
  const pastEncMap = new Map(
    evidence.historical_encounters.map((e) => [e.id, e]),
  );

  const historicalMatches: HistoricalEpisodeMatch[] = [];
  for (const m of analystMatches) {
    const pastEnc = pastEncMap.get(m.encounter_id);
    if (pastEnc) {
      historicalMatches.push({
        historical_encounter_id: m.encounter_id,
        date: pastEnc.started_at,
        chief_concern: pastEnc.chief_concern,
        similarity_label: m.similarity_label,
        similarity_score: null,
        supporting_features: m.supporting_features,
        differences: m.differences,
        outcome: null,
      });
    }
  }

  // 3. Determine uncertainty level
  const disagreementCount = judgment.material_disagreements.length;
  const uncertaintyLevel =
    disagreementCount > 2 ? "HIGH" : disagreementCount > 0 ? "MEDIUM" : "LOW";

  // 4. Construct safe summary
  const needsReview =
    judgment.requires_doctor_review ||
    judgment.material_disagreements.length > 0 ||
    judgment.unsupported_claims.length > 0 ||
    sanitizedGuidance.length === 0;
  const disposition = judgment.requires_urgent_escalation
    ? "URGENT"
    : needsReview
      ? "DOCTOR_REVIEW"
      : "SELF_CARE";
  const summary =
    disposition === "URGENT"
      ? "Get urgent medical help now."
      : disposition === "DOCTOR_REVIEW"
        ? "A doctor should review this check-in."
        : "Self-care guidance is available for this check-in.";

  const outcome: PatientCheckinOutcome = {
    disposition,
    requires_urgent_escalation: judgment.requires_urgent_escalation,
    requires_doctor_review: needsReview,
    summary,
    low_risk_guidance: disposition === "URGENT" ? [] : sanitizedGuidance,
    uncertainty_level: uncertaintyLevel,
    questions_for_doctor: judgment.questions_to_ask_next,
    historical_matches: historicalMatches,
    statutory_warning: STATUTORY_NON_REUSE_WARNING,
  };

  return {
    outcome,
    historicalMatches,
  };
}
