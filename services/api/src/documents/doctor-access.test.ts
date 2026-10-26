import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentRoutes } from "./routes.js";

const mocks = vi.hoisted(() => ({
  database: { select: vi.fn(), insert: vi.fn() },
  allowed: true,
  signedView: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../db.js", () => ({ db: mocks.database }));
vi.mock("../auth/guards.js", () => ({
  requireDoctor: () => "doctor-own",
  requirePatient: () => "patient-own",
  authorizePatientAccess: async () => mocks.allowed,
}));
vi.mock("../audit/log.js", () => ({ logAccess: vi.fn() }));
vi.mock("../storage.js", () => ({
  signedViewUrl: mocks.signedView,
  downloadObject: mocks.download,
  signedUploadUrl: vi.fn(),
}));
vi.mock("../queue.js", () => ({ sendDocumentExtract: vi.fn() }));

/** Makes sure source previews and uploads cannot cross clinician or patient records. */
describe("doctor source access", () => {
  let app: FastifyInstance;
  let row: Record<string, unknown>;
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.allowed = true;
    mocks.signedView.mockResolvedValue(
      "https://source.example.test/synthetic.pdf",
    );
    row = {
      id: "doc-own",
      patientId: "patient-own",
      uploadedByActorType: "DOCTOR",
      uploadedByActorId: "doctor-own",
      deletedAt: null,
      storageObjectKey: "synthetic-key",
      documentType: "LAB_REPORT",
      originalFilename: "synthetic.pdf",
      mimeType: "application/pdf",
      processingStatus: "COMPLETE",
      createdAt: new Date("2026-10-25T09:00:00Z"),
    };
    mocks.database.select.mockImplementation(() => ({
      from: () => ({ where: () => ({ limit: async () => [row] }) }),
    }));
    app = Fastify();
    app.addHook("onRequest", async (request) => {
      request.auth = {
        role: "DOCTOR",
        doctorId: "doctor-own",
      } as typeof request.auth;
    });
    await app.register(documentRoutes);
  });
  afterEach(async () => {
    await app.close();
  });

  it("opens the original source for the owning clinician", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/doctor/documents/doc-own",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().view_url).toBe(
      "https://source.example.test/synthetic.pdf",
    );
    expect(mocks.signedView).toHaveBeenCalledWith("synthetic-key");
  });
  it.each(["PATIENT", "OTHER_DOCTOR"])(
    "requires consent before signing a %s source",
    async (type) => {
      if (type === "PATIENT") row.uploadedByActorType = "PATIENT";
      else row.uploadedByActorId = "doctor-other";
      const response = await app.inject({
        method: "GET",
        url: "/doctor/documents/doc-own",
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("CONSENT_REQUIRED");
      expect(mocks.signedView).not.toHaveBeenCalled();
    },
  );
  it("denies an unrelated clinician before signing any original", async () => {
    mocks.allowed = false;
    const response = await app.inject({
      method: "GET",
      url: "/doctor/documents/doc-own",
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.signedView).not.toHaveBeenCalled();
  });
  it("does not complete another clinician's upload", async () => {
    row.uploadedByActorId = "doctor-other";
    const response = await app.inject({
      method: "POST",
      url: "/doctor/patients/patient-own/documents/doc-own/upload-complete",
      payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.download).not.toHaveBeenCalled();
  });
  it("rejects an upload attached to a foreign encounter before creating a document", async () => {
    row = { patientId: "patient-other", relatedDoctorId: "doctor-own" };
    const response = await app.inject({
      method: "POST",
      url: "/doctor/patients/patient-own/documents/upload-init",
      payload: {
        filename: "synthetic.pdf",
        mime_type: "application/pdf",
        document_type: "LAB_REPORT",
        encounter_id: "fdd87f59-23b7-4472-8fca-79cfad6a592d",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(mocks.database.insert).not.toHaveBeenCalled();
  });
});
