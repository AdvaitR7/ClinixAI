/** Returns a supported workspace route for a database-resolved application role. */
export function workspacePathForRole(role: string): string | null {
  if (role === "PATIENT") return "/app/patient";
  if (role === "DOCTOR") return "/app/doctor";
  if (role === "CLINIC_STAFF") return "/app/staff";
  return null;
}
