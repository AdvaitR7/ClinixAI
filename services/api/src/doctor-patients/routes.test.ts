import Fastify, { type FastifyInstance } from "fastify";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { doctorPatientRoutes } from "./routes.js";
import {
  appointments,
  consentScopes,
  consents,
  documents,
  encounters,
  labReports,
  patientIdentity,
  patients,
  prescriptions,
} from "../schema.js";

const mocks = vi.hoisted(() => ({
  database: { select: vi.fn() },
  allowed: true,
  log: vi.fn(),
  medications: vi.fn(),
  report: vi.fn(),
}));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({
  requireDoctor: () => "doctor-own",
  authorizePatientAccess: async () => mocks.allowed,
}));
vi.mock("../audit/log.js", () => ({ logAccess: mocks.log }));
vi.mock("../medications/derive.js", () => ({
  medicationsForPatient: mocks.medications,
}));
vi.mock("../documents/routes.js", () => ({ loadReportView: mocks.report }));
vi.mock("../patients/identity.js", () => ({
  decryptMinimal: (row: unknown) => row,
  encryptPatientIdentity: vi.fn(),
  isAdult: () => true,
}));

/** Verifies the real workspace handler's composition and SQL scope with synthetic rows. */
describe("doctor patient record composition", () => {
  let app: FastifyInstance;
  let data: Map<unknown, unknown[]>;
  let queries: { table: unknown; sql: string; params: unknown[] }[];
  const dialect = new PgDialect();
  const at = new Date("2026-10-25T09:00:00Z");

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.allowed = true;
    mocks.medications.mockResolvedValue([]);
    mocks.report.mockResolvedValue({
      report_id: "report-own",
      source_document_id: "doc-own",
      observations: [],
    });
    data = new Map<unknown, unknown[]>([
      [patients, [{ status: "CLAIMED" }]],
      [
        patientIdentity,
        [
          {
            full_name: "Synthetic One",
            phone: "9999000011",
            date_of_birth: null,
            sex_at_registration: null,
          },
        ],
      ],
      [appointments, []],
      [encounters, []],
      [documents, []],
      [prescriptions, []],
      [labReports, []],
    ]);
    queries = [];
    mocks.database.select.mockImplementation(() => {
      let table: unknown;
      const builder = {
        from: (value: unknown) => {
          table = value;
          return builder;
        },
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: (condition: Parameters<PgDialect["sqlToQuery"]>[0]) => {
          queries.push({ table, ...dialect.sqlToQuery(condition) });
          const rows = data.get(table) ?? [];
          const result = Object.assign(Promise.resolve(rows), {
            orderBy: () => result,
            limit: () => result,
            groupBy: () => result,
          });
          return result;
        },
      };
      return builder;
    });
    app = Fastify();
    await app.register(doctorPatientRoutes);
  });
  afterEach(async () => {
    await app.close();
  });

  const grant = (scopes: { resourceType: string; resourceId: string | null }[], over: Record<string, unknown> = {}) => {
    data.set(consents, [{ id: "consent-1", patientId: "patient-own", granteeType: "DOCTOR", granteeId: "doctor-own", purpose: "Follow-up", status: "ACTIVE", startsAt: new Date("2026-10-01T00:00:00Z"), expiresAt: null, revokedAt: null, ...over }]);
    data.set(consentScopes, scopes.map((scope) => ({ consentId: "consent-1", ...scope })));
  };

  it("lets an active medication consent widen medications and reports the remaining locked groups", async () => {
    mocks.allowed = false;
    grant([{ resourceType: "MEDICATION", resourceId: null }]);
    const response = await app.inject({ method: "GET", url: "/doctor/patients/patient-own/workspace" });
    expect(response.statusCode).toBe(200);
    expect(mocks.medications).toHaveBeenCalledWith("patient-own", undefined);
    const body = response.json();
    expect(body).toMatchObject({ consent_active: true, access_scope: "CONSENT_SCOPED" });
    const locked = body.locked_sections.map((s: { section_name: string }) => s.section_name);
    expect(locked).not.toContain("Medication history");
    expect(locked).toContain("Health timeline");
    expect(mocks.log).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ consentId: "consent-1", purpose: "Follow-up" }));
  });

  it("ignores expired and revoked consents", async () => {
    mocks.allowed = false;
    grant([{ resourceType: "MEDICATION", resourceId: null }], { expiresAt: new Date("2026-10-02T00:00:00Z") });
    expect((await app.inject({ method: "GET", url: "/doctor/patients/patient-own/workspace" })).statusCode).toBe(403);
    grant([{ resourceType: "MEDICATION", resourceId: null }], { status: "REVOKED", revokedAt: new Date("2026-10-02T00:00:00Z") });
    expect((await app.inject({ method: "GET", url: "/doctor/patients/patient-own/workspace" })).statusCode).toBe(403);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("denies unrelated access before querying identity or records", async () => {
    mocks.allowed = false;
    const response = await app.inject({
      method: "GET",
      url: "/doctor/patients/patient-own/workspace",
    });
    expect(response.statusCode).toBe(403);
    // Only the consent lookup runs; no identity or clinical record is read.
    expect(queries.map((query) => query.table)).not.toContain(patientIdentity);
    expect(queries.map((query) => query.table)).not.toContain(encounters);
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("returns unknown safety/consent and empty records instead of clinical fixtures", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/doctor/patients/patient-own/workspace",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      allergies: [],
      consent_active: false,
      current_concern: null,
      access_scope: "DOCTOR_OWN_RECORDS",
      medications: [],
      reports: [],
      documents: [],
      timeline: [],
    });
    expect(response.body).not.toMatch(
      /Penicillin|Vitamin D|Migraine|CONSENT ACTIVE/,
    );
    expect(mocks.medications).toHaveBeenCalledWith("patient-own", "doctor-own");
    // Uncovered record groups are reported as locked, never silently omitted.
    expect(response.json().locked_sections.map((s: { section_name: string }) => s.section_name)).toContain("Medication history");
  });

  it("scopes every composed appointment, encounter, document and prescription to this patient and doctor", async () => {
    await app.inject({
      method: "GET",
      url: "/doctor/patients/patient-own/workspace",
    });
    for (const table of [appointments, encounters, documents, prescriptions]) {
      const query = queries.find((entry) => entry.table === table)!;
      expect(query.params).toContain("patient-own");
      expect(query.params).toContain("doctor-own");
    }
    const documentQuery = queries.find((entry) => entry.table === documents)!;
    expect(documentQuery.params).toContain("DOCTOR");
    expect(documentQuery.sql).toContain('"deleted_at" is null');
  });

  it("preserves patient-reported authority and returns only source-backed reports", async () => {
    data.set(encounters, [
      {
        id: "encounter-own",
        chiefConcern: "Synthetic concern",
        encounterType: "AI_CHECKIN",
        initiatedByActorType: "PATIENT",
        startedAt: at,
      },
    ]);
    data.set(documents, [
      {
        id: "doc-own",
        originalFilename: "synthetic.pdf",
        documentType: "LAB_REPORT",
        mimeType: "application/pdf",
        processingStatus: "COMPLETE",
        fileSizeBytes: 12,
        createdAt: at,
      },
    ]);
    data.set(labReports, [{ id: "report-own" }]);
    const response = await app.inject({
      method: "GET",
      url: "/doctor/patients/patient-own/workspace",
    });
    expect(response.statusCode).toBe(200);
    expect(
      response
        .json()
        .timeline.find((entry: { kind: string }) => entry.kind === "encounter")
        .provenance,
    ).toBe("PATIENT_REPORTED");
    expect(response.json().current_concern).toBe("Synthetic concern");
    expect(mocks.report).toHaveBeenCalledWith("report-own");
    const reportQuery = queries.find((query) => query.table === labReports)!;
    expect(reportQuery.params).toEqual(
      expect.arrayContaining(["patient-own", "doc-own"]),
    );
    expect(mocks.log).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        patientId: "patient-own",
        resourceType: "PATIENT_WORKSPACE",
      }),
    );
  });

  it("supports ID search and upcoming filters using only the clinician's appointment metadata", async () => {
    data.set(patients, [
      {
        patientId: "patient-one",
        patientStatus: "CLAIMED",
        relationshipStatus: "ACTIVE",
        identity: { full_name: "Synthetic One", phone: "9999000011" },
      },
      {
        patientId: "patient-two",
        patientStatus: "UNCLAIMED",
        relationshipStatus: "ACTIVE",
        identity: { full_name: "Synthetic Two", phone: "9999000022" },
      },
    ]);
    data.set(encounters, [{ patientId: "patient-one", lastAt: at }]);
    data.set(appointments, [
      { patientId: "patient-one", at: new Date("2099-10-25T09:00:00Z") },
    ]);
    const searched = await app.inject({
      method: "GET",
      url: "/doctor/patients?q=patient-two",
    });
    expect(searched.statusCode).toBe(200);
    expect(
      searched
        .json()
        .map((patient: { patient_id: string }) => patient.patient_id),
    ).toEqual(["patient-two"]);
    const upcoming = await app.inject({
      method: "GET",
      url: "/doctor/patients?filter=upcoming",
    });
    expect(upcoming.statusCode).toBe(200);
    expect(
      upcoming
        .json()
        .map((patient: { patient_id: string }) => patient.patient_id),
    ).toEqual(["patient-one"]);
    expect(
      queries.find((query) => query.table === appointments)?.params,
    ).toContain("doctor-own");
    const unclaimed = await app.inject({
      method: "GET",
      url: "/doctor/patients?filter=unclaimed",
    });
    expect(unclaimed.json()[0].patient_id).toBe("patient-two");
  });
});
