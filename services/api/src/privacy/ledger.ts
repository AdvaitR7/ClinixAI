import type { LedgerCategory } from "@clinix/schemas";

const AI_ACTIONS = new Set(["AI_PROCESS", "OCR_EXTRACT"]);
const ADMIN_ACTORS = new Set(["CLINIC_STAFF", "ADMIN", "SYSTEM"]);

/** Ledger tab an event belongs to: AI audit, administrative, or clinical access. */
export function ledgerCategory(actorType: string, action: string): LedgerCategory {
  if (actorType === "AI_SERVICE" || AI_ACTIONS.has(action)) return "AI";
  if (ADMIN_ACTORS.has(actorType)) return "ADMIN";
  return "CLINICAL";
}

const RESOURCE_LABELS: Record<string, string> = {
  PATIENT_WORKSPACE: "Clinical record summary",
  DOCUMENT: "Document",
  LAB_REPORT: "Lab report",
  PRESCRIPTION: "Prescription",
  AI_SESSION: "AI check-in result",
  INTERACTION_SESSION: "AI check-in answers",
  ENCOUNTER: "Encounter",
  MEDICATION: "Medication history",
  TIMELINE: "Health timeline",
};

const ACTION_LABELS: Record<string, string> = {
  VIEW: "Viewed",
  READ: "Viewed",
  CREATE: "Created",
  PRINT: "Printed",
  UPLOAD_INIT: "Started upload",
  UPLOAD_COMPLETE: "Uploaded",
  CONFIRM: "Confirmed",
  CORRECT: "Corrected",
  OCR_EXTRACT: "Read by document extraction",
  AI_PROCESS: "Analysed by AI",
  EXPORT: "Exported",
  SHARE: "Shared",
  REVOKE_ACCESS: "Access revoked",
};

/** Plain-language resource name; unknown types fall back to a readable form of the code. */
export function resourceLabel(resourceType: string): string {
  return (
    RESOURCE_LABELS[resourceType] ??
    resourceType.charAt(0) + resourceType.slice(1).toLowerCase().replace(/_/g, " ")
  );
}

/** Plain-language action name for the ledger. */
export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.charAt(0) + action.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Actions per category, used to build SQL filters and counts without a stored category column. */
export function categoryOf(row: { actorType: string; action: string }): LedgerCategory {
  return ledgerCategory(row.actorType, row.action);
}
