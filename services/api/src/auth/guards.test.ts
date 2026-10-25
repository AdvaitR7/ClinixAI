import { describe, expect, it, vi } from "vitest";
import { authorizePatientAccess } from "./guards.js";
import type { AuthContext } from "./context.js";

/** Keeps the unit test independent of an external PostgreSQL connection. */
vi.mock("../db.js", () => ({ db: null }));

const patientAuth: AuthContext = {
  supabaseUserId: "2e036082-69a1-4b95-88d9-3190ded27f62",
  profileId: "d01fc949-f7d5-44cb-b7e9-7804e83cff38",
  role: "PATIENT",
  patientId: "fdd87f59-23b7-4472-8fca-79cfad6a592d",
  doctorId: null,
};

/** Verifies ownership checks fail closed for records outside the patient account. */
describe("patient resource ownership", () => {
  it("allows a patient to access their own record", async () => {
    await expect(authorizePatientAccess(patientAuth, patientAuth.patientId!)).resolves.toBe(true);
  });

  it("denies a patient access to another patient's record", async () => {
    await expect(authorizePatientAccess(patientAuth, "5d167a2b-d772-4938-8fb8-747154bfc3b5"))
      .resolves.toBe(false);
  });

  it("denies doctor access if an active relationship cannot be confirmed", async () => {
    await expect(authorizePatientAccess({ ...patientAuth, role: "DOCTOR", patientId: null, doctorId: "a9fcf736-7f32-451a-a39c-9c5c4321e3ec" }, "5d167a2b-d772-4938-8fb8-747154bfc3b5"))
      .resolves.toBe(false);
  });
});
