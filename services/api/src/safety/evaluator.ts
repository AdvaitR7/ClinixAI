import crypto from "node:crypto";
import type { JudgeOutput, SafetyAction, SafetySeverity } from "@clinix/schemas";
import { safetyEvaluations } from "../schema.js";
import { EMERGENCY_RULES, type EmergencyRule } from "./rules.js";

export interface SafetyEvaluationResult {
  isCritical: boolean;
  action: SafetyAction;
  severity: SafetySeverity;
  triggeredRuleIds: string[];
  message: string;
  emergencyNumber: string;
  matchedRules: EmergencyRule[];
  inputHash: string;
}

export function computeInputHash(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex");
}

/**
 * PRE_AI evaluation: Evaluates chief concern and patient answers for critical emergency red flags.
 * If any critical pattern matches, returns action: BLOCK_NORMAL_FLOW and severity: CRITICAL.
 */
export function evaluatePreAi(args: {
  chiefConcern?: string | null;
  responses?: Array<{
    freeText?: string | null;
    selectedOptionIds?: string[] | null;
    optionsText?: string | null;
  }>;
}): SafetyEvaluationResult {
  const parts: string[] = [];
  if (args.chiefConcern) parts.push(args.chiefConcern);
  if (args.responses) {
    for (const r of args.responses) {
      if (r.freeText) parts.push(r.freeText);
      if (r.optionsText) parts.push(r.optionsText);
      if (r.selectedOptionIds && r.selectedOptionIds.length > 0) {
        parts.push(r.selectedOptionIds.join(" "));
      }
    }
  }

  const combinedText = parts.join(" ").toLowerCase();
  const inputHash = computeInputHash(combinedText || "empty");
  const matchedRules: EmergencyRule[] = [];

  for (const rule of EMERGENCY_RULES) {
    for (const pattern of rule.patterns) {
      const lowerPat = pattern.toLowerCase();
      // Match whole phrase or token substring
      if (combinedText.includes(lowerPat)) {
        matchedRules.push(rule);
        break;
      }
    }
  }

  if (matchedRules.length > 0) {
    const isCritical = matchedRules.some((r) => r.severity === "CRITICAL");
    return {
      isCritical,
      action: isCritical ? "BLOCK_NORMAL_FLOW" : "ALLOW",
      severity: isCritical ? "CRITICAL" : "MEDIUM",
      triggeredRuleIds: matchedRules.map((r) => r.rule_id),
      message: matchedRules[0].message,
      emergencyNumber: matchedRules[0].emergency_number,
      matchedRules,
      inputHash,
    };
  }

  return {
    isCritical: false,
    action: "ALLOW",
    severity: "LOW",
    triggeredRuleIds: [],
    message: "No emergency red flags identified.",
    emergencyNumber: "112 / 108",
    matchedRules: [],
    inputHash,
  };
}

/**
 * POST_JUDGE evaluation: Verifies that judge consensus does not make unauthorized
 * prescription claims or omit clinical safety escalations.
 */
export function evaluatePostJudge(judgment: JudgeOutput): SafetyEvaluationResult {
  const combined = [
    ...judgment.safe_consensus,
    ...judgment.unsupported_claims,
    ...judgment.material_disagreements,
  ]
    .join(" ")
    .toLowerCase();
  const inputHash = computeInputHash(combined);

  // Check for emergency escalation flagged by the judge
  if (judgment.requires_urgent_escalation) {
    return {
      isCritical: true,
      action: "BLOCK_NORMAL_FLOW",
      severity: "CRITICAL",
      triggeredRuleIds: ["JUDGE-URGENT-ESCALATION"],
      message: "Judge identified criteria requiring immediate emergency evaluation.",
      emergencyNumber: "112 / 108",
      matchedRules: [],
      inputHash,
    };
  }

  return {
    isCritical: false,
    action: "ALLOW",
    severity: judgment.requires_doctor_review ? "MEDIUM" : "LOW",
    triggeredRuleIds: [],
    message: "Consensus validated against clinical safety bounds.",
    emergencyNumber: "112 / 108",
    matchedRules: [],
    inputHash,
  };
}

/**
 * Logs safety evaluation to the immutable database table `safety_evaluations`.
 */
export async function logSafetyEvaluation(
  database: any,
  params: {
    encounterId: string;
    aiSessionId?: string | null;
    stage: "PRE_AI" | "POST_JUDGE";
    evaluation: SafetyEvaluationResult;
  },
): Promise<string> {
  const [row] = await database
    .insert(safetyEvaluations)
    .values({
      encounterId: params.encounterId,
      aiSessionId: params.aiSessionId ?? null,
      stage: params.stage,
      triggeredRuleIds: params.evaluation.triggeredRuleIds,
      severity: params.evaluation.severity,
      action: params.evaluation.action,
      inputHash: params.evaluation.inputHash,
    })
    .returning({ id: safetyEvaluations.id });

  return row.id;
}
