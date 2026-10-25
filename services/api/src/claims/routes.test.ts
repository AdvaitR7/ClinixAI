import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { claimRoutes } from "./routes.js";
import { patientClaimInvites, patients, profiles } from "../schema.js";

const mocks = vi.hoisted(() => ({
  database: { transaction: vi.fn() },
  ensureProfile: vi.fn(),
}));

vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../crypto.js", () => ({ hashIdentity: () => "synthetic-invite-hash" }));
vi.mock("../auth/bearer.js", () => ({
  verifiedBearer: async () => ({ userId: "2e036082-69a1-4b95-88d9-3190ded27f62", displayName: "Synthetic" }),
}));
vi.mock("../auth/supabase.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../auth/supabase.js")>(),
  ensureProfile: mocks.ensureProfile,
}));

describe("patient claim identity safety", () => {
  let app: FastifyInstance;
  let profileRows: Record<string, unknown>[];
  let ownedPatients: Record<string, unknown>[];
  let invite: Record<string, unknown> | null;
  let update: ReturnType<typeof vi.fn>;
  let rollback: boolean;
  let patientUpdateSucceeds: boolean;

  beforeEach(async () => {
    profileRows = [];
    ownedPatients = [];
    rollback = false;
    patientUpdateSucceeds = true;
    invite = { id: "invite-test", patientId: "patient-to-claim", status: "OPEN", expiresAt: new Date(Date.now() + 60_000) };
    mocks.ensureProfile.mockReset().mockResolvedValue({ id: "verified-profile", primaryRole: "PATIENT" });
    update = vi.fn((table) => ({ set: () => ({ where: () => ({ returning: async () =>
      table === patients ? patientUpdateSucceeds ? [{ id: "patient-to-claim" }] : [] : [{ id: "invite-test" }],
    }) }) }));
    const tx = {
      select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: () => {
        const rows = table === profiles ? profileRows : table === patientClaimInvites ? invite ? [invite] : [] : ownedPatients;
        return Object.assign(Promise.resolve(rows), { for: async () => rows });
      } }) }) }),
      update,
      insert: () => ({ values: async () => [] }),
    };
    mocks.database.transaction.mockImplementation(async (callback) => {
      try { return await callback(tx); }
      catch (cause) { rollback = true; throw cause; }
    });
    app = Fastify();
    await app.register(claimRoutes);
  });

  afterEach(async () => { await app.close(); });

  it("rechecks ownership after another onboarding request has created the profile", async () => {
    // The initial profile lookup misses, but ensureProfile returns the row from
    // a concurrent onboarding transaction that already claimed a patient.
    ownedPatients = [{ id: "already-owned-patient" }];
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("ACCOUNT_ALREADY_LINKED");
    expect(update).not.toHaveBeenCalled();
  });

  it.each(["DOCTOR", "CLINIC_STAFF", "ADMIN"])("cannot convert an existing %s profile through a claim", async (role) => {
    profileRows = [{ id: "existing-profile", primaryRole: role }];
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("PROFILE_ROLE_CONFLICT");
    expect(mocks.ensureProfile).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("does not create a profile for an invalid invitation", async () => {
    invite = null;
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(400);
    expect(mocks.ensureProfile).not.toHaveBeenCalled();
  });

  it("does not create a profile for an expired invitation", async () => {
    invite!.expiresAt = new Date(Date.now() - 60_000);
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("INVITE_EXPIRED");
    expect(mocks.ensureProfile).not.toHaveBeenCalled();
  });

  it("rolls back the transaction if another account wins the patient claim", async () => {
    patientUpdateSucceeds = false;
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(409);
    expect(rollback).toBe(true);
  });

  it("returns the same internal patient ID for an already completed claim", async () => {
    invite!.status = "USED";
    profileRows = [{ id: "verified-profile", primaryRole: "PATIENT" }];
    ownedPatients = [{ id: "patient-to-claim" }];
    const response = await app.inject({ method: "POST", url: "/patient-claims", payload: { invite_token: "synthetic-claim-code" } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ patient_id: "patient-to-claim" });
    expect(update).not.toHaveBeenCalled();
  });
});
