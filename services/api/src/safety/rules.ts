import fs from "node:fs";
import type { SafetyAction, SafetySeverity } from "@clinix/schemas";

export interface EmergencyRule {
  rule_id: string;
  category: string;
  title: string;
  severity: SafetySeverity;
  action: SafetyAction;
  patterns: string[];
  message: string;
  emergency_number: string;
}

const emergencyJsonPath = new URL("./rule_sets/emergency.json", import.meta.url);
const rawEmergency = fs.readFileSync(emergencyJsonPath, "utf-8");
export const EMERGENCY_RULES: EmergencyRule[] = JSON.parse(rawEmergency);
