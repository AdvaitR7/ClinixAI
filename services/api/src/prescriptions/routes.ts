import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  amendPrescriptionSchema,
  createPrescriptionDraftSchema,
  finalizePrescriptionDraftSchema,
  patchPrescriptionDraftSchema,
  type PrescriptionItemInput,
  type PrescriptionItemView,
  type PrescriptionView,
} from "@clinix/schemas";
import { authorizePatientAccess, requireDoctor, requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import { logAccess } from "../audit/log.js";
import {
  doctors,
  encounters,
  prescriptionDraftItems,
  prescriptionDrafts,
  prescriptionItems,
  prescriptionVersions,
  prescriptions,
  profiles,
} from "../schema.js";
import { patientNames } from "../appointments/map.js";
import {
  buildPrescriptionView,
  draftView,
  versionView,
} from "./map.js";
import { renderPrescriptionPdf } from "./pdf.js";

/** Hashes ordered clinical fields so a review cannot finalize different content. */
function contentHash(items: (PrescriptionItemInput | PrescriptionItemView)[]): string {
  const canonical = items.map((it) => [
    it.medicine_name,
    it.strength ?? "",
    it.dose ?? "",
    it.route ?? "",
    it.frequency ?? "",
    it.timing ?? "",
    it.duration ?? "",
    it.instructions ?? "",
  ]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

async function doctorName(doctorId: string): Promise<string> {
  const database = requireDb();
  const rows = await database
    .select({ name: profiles.displayName })
    .from(doctors)
    .innerJoin(profiles, eq(profiles.id, doctors.profileId))
    .where(eq(doctors.id, doctorId))
    .limit(1);
  return rows[0]?.name ?? "";
}

/** Loads a full prescription view (all versions + items + finalizer names). */
async function loadPrescriptionView(id: string): Promise<PrescriptionView | null> {
  const database = requireDb();
  const [rx] = await database
    .select()
    .from(prescriptions)
    .where(eq(prescriptions.id, id))
    .limit(1);
  if (!rx) return null;

  const versions = await database
    .select()
    .from(prescriptionVersions)
    .where(eq(prescriptionVersions.prescriptionId, id))
    .orderBy(asc(prescriptionVersions.versionNumber));

  const items = versions.length
    ? await database
        .select()
        .from(prescriptionItems)
        .where(
          inArray(
            prescriptionItems.prescriptionVersionId,
            versions.map((v) => v.id),
          ),
        )
        .orderBy(asc(prescriptionItems.sequenceNumber))
    : [];

  const doctorIds = [...new Set(versions.map((v) => v.finalizedByDoctorId))];
  const nameRows = doctorIds.length
    ? await database
        .select({ doctorId: doctors.id, name: profiles.displayName })
        .from(doctors)
        .innerJoin(profiles, eq(profiles.id, doctors.profileId))
        .where(inArray(doctors.id, doctorIds))
    : [];
  const nameByDoctor = new Map(nameRows.map((r) => [r.doctorId, r.name]));

  const versionViews = versions.map((v) =>
    versionView(
      v,
      items.filter((i) => i.prescriptionVersionId === v.id),
      nameByDoctor.get(v.finalizedByDoctorId) ?? "",
    ),
  );

  const current = versions.find((v) => v.id === rx.currentVersionId);
  return buildPrescriptionView({
    id: rx.id,
    patientId: rx.patientId,
    doctorId: rx.doctorId,
    status: rx.status,
    createdAt: rx.createdAt,
    currentVersionNumber: current?.versionNumber ?? null,
    versions: versionViews,
  });
}

/**
 * Prescription drafts + finalization (API §19, §22–26).
 *
 * SAFETY: finalize is reachable ONLY through a Supabase session verified as a
 * doctor (requireDoctor). No AI/service principal can call it. When the Phase 4
 * worker lands, it must never be able to reach this route.
 */
export async function prescriptionRoutes(app: FastifyInstance) {
  app.post<{ Params: { encounter_id: string } }>(
    "/doctor/encounters/:encounter_id/prescription-drafts",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = createPrescriptionDraftSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid draft payload");
      }
      const body = parsed.data;

      const database = requireDb();
      const enc = (
        await database
          .select()
          .from(encounters)
          .where(eq(encounters.id, request.params.encounter_id))
          .limit(1)
      )[0];
      if (!enc) return error(request, reply, 404, "NOT_FOUND", "Encounter not found");
      const allowed = await authorizePatientAccess(request.auth, enc.patientId);
      if (!allowed) {
        return error(request, reply, 403, "FORBIDDEN", "Not authorized for this encounter");
      }

      const [draft] = await database
        .insert(prescriptionDrafts)
        .values({
          patientId: enc.patientId,
          encounterId: enc.id,
          doctorId,
          source: body.source,
          status: "DRAFT",
        })
        .returning();

      await database.insert(prescriptionDraftItems).values(
        body.items.map((it, i) => ({
          draftId: draft.id,
          sequenceNumber: i + 1,
          medicineName: it.medicine_name,
          strength: it.strength ?? null,
          dose: it.dose ?? null,
          route: it.route ?? null,
          frequency: it.frequency ?? null,
          timing: it.timing ?? null,
          duration: it.duration ?? null,
          instructions: it.instructions ?? null,
        })),
      );

      const names = await patientNames([enc.patientId]);
      const items = await database
        .select()
        .from(prescriptionDraftItems)
        .where(eq(prescriptionDraftItems.draftId, draft.id))
        .orderBy(asc(prescriptionDraftItems.sequenceNumber));

      return reply.code(201).send(draftView(draft, names.get(enc.patientId) ?? "", items));
    },
  );

  app.get("/doctor/prescription-drafts", async (request, reply) => {
    const doctorId = requireDoctor(request, reply);
    if (typeof doctorId !== "string") return doctorId;

    const { status, source } = request.query as { status?: string; source?: string };
    const database = requireDb();

    const rows = await database
      .select()
      .from(prescriptionDrafts)
      .where(
        and(
          eq(prescriptionDrafts.doctorId, doctorId),
          ...(status ? [eq(prescriptionDrafts.status, status as never)] : []),
          ...(source ? [eq(prescriptionDrafts.source, source as never)] : []),
        ),
      )
      .orderBy(desc(prescriptionDrafts.createdAt));

    if (rows.length === 0) return [];

    const draftItems = await database
      .select()
      .from(prescriptionDraftItems)
      .where(
        inArray(
          prescriptionDraftItems.draftId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(prescriptionDraftItems.sequenceNumber));
    const itemsByDraft = new Map<string, typeof draftItems>();
    for (const it of draftItems) {
      const list = itemsByDraft.get(it.draftId) ?? [];
      list.push(it);
      itemsByDraft.set(it.draftId, list);
    }

    const names = await patientNames(rows.map((r) => r.patientId));
    return rows.map((r) => draftView(r, names.get(r.patientId) ?? "", itemsByDraft.get(r.id) ?? []));
  });

  app.get<{ Params: { draft_id: string } }>(
    "/doctor/prescription-drafts/:draft_id",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const database = requireDb();
      const [draft] = await database
        .select()
        .from(prescriptionDrafts)
        .where(eq(prescriptionDrafts.id, request.params.draft_id))
        .limit(1);
      if (!draft) return error(request, reply, 404, "NOT_FOUND", "Draft not found");
      if (draft.doctorId !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your draft");
      }

      const items = await database
        .select()
        .from(prescriptionDraftItems)
        .where(eq(prescriptionDraftItems.draftId, draft.id))
        .orderBy(asc(prescriptionDraftItems.sequenceNumber));
      const names = await patientNames([draft.patientId]);
      return draftView(draft, names.get(draft.patientId) ?? "", items);
    },
  );

  app.patch<{ Params: { draft_id: string } }>(
    "/doctor/prescription-drafts/:draft_id",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = patchPrescriptionDraftSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid draft payload");
      }
      const body = parsed.data;

      const database = requireDb();
      const result = await database.transaction(async (tx) => {
        const [draft] = await tx
          .select()
          .from(prescriptionDrafts)
          .where(eq(prescriptionDrafts.id, request.params.draft_id))
          .for("update");
        if (!draft) return { status: 404, code: "NOT_FOUND", message: "Draft not found" };
        if (draft.doctorId !== doctorId) {
          return { status: 403, code: "FORBIDDEN", message: "Not your draft" };
        }
        if (draft.status === "APPROVED") {
          return { status: 409, code: "DRAFT_FINALIZED", message: "Finalized drafts cannot be edited" };
        }

        if (body.items) {
          await tx
            .delete(prescriptionDraftItems)
            .where(eq(prescriptionDraftItems.draftId, draft.id));
          await tx.insert(prescriptionDraftItems).values(
            body.items.map((it, i) => ({
              draftId: draft.id,
              sequenceNumber: i + 1,
              medicineName: it.medicine_name,
              strength: it.strength ?? null,
              dose: it.dose ?? null,
              route: it.route ?? null,
              frequency: it.frequency ?? null,
              timing: it.timing ?? null,
              duration: it.duration ?? null,
              instructions: it.instructions ?? null,
            })),
          );
        }
        if (body.items || body.status) {
          await tx
            .update(prescriptionDrafts)
            .set({ ...(body.status ? { status: body.status } : {}), updatedAt: new Date() })
            .where(eq(prescriptionDrafts.id, draft.id));
        }
        return null;
      });
      if (result) return error(request, reply, result.status, result.code, result.message);
      return { ok: true };
    },
  );

  app.delete<{ Params: { draft_id: string } }>(
    "/doctor/prescription-drafts/:draft_id",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const database = requireDb();
      const [draft] = await database
        .select()
        .from(prescriptionDrafts)
        .where(eq(prescriptionDrafts.id, request.params.draft_id))
        .limit(1);
      if (!draft) return error(request, reply, 404, "NOT_FOUND", "Draft not found");
      if (draft.doctorId !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your draft");
      }
      if (draft.status === "APPROVED") {
        return error(request, reply, 409, "DRAFT_FINALIZED", "Finalized drafts cannot be deleted");
      }

      await database
        .delete(prescriptionDraftItems)
        .where(eq(prescriptionDraftItems.draftId, draft.id));
      await database
        .delete(prescriptionDrafts)
        .where(eq(prescriptionDrafts.id, draft.id));
      return { ok: true };
    },
  );

  app.post<{ Params: { draft_id: string } }>(
    "/doctor/prescription-drafts/:draft_id/finalize",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const key = request.headers["idempotency-key"];
      if (!key || typeof key !== "string" || key.trim() === "") {
        return error(request, reply, 400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
      }

      const parsed = finalizePrescriptionDraftSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid reviewed prescription");
      }

      const database = requireDb();
      const existing = await loadPrescriptionByDraft(request.params.draft_id, doctorId);
      if (existing) {
        if (parsed.data.reviewed_items && contentHash(parsed.data.reviewed_items) !== contentHash(existing.versions[0].items)) {
          return error(request, reply, 409, "DRAFT_CHANGED", "This draft was finalized with different content. Reopen the prescription to review it.");
        }
        // Idempotent replay: a re-finalize of an already-APPROVED draft returns
        // the same prescription (ponytail: no key store; draft state is the signal).
        return reply.send(existing);
      }

      let prescriptionId: string;
      try {
        prescriptionId = await database.transaction(async (tx) => {
          const [draft] = await tx
            .select()
            .from(prescriptionDrafts)
            .where(eq(prescriptionDrafts.id, request.params.draft_id))
            .for("update");
          if (!draft) throw Object.assign(new Error("not found"), { code: 404 });
          if (draft.doctorId !== doctorId) {
            throw Object.assign(new Error("forbidden"), { code: 403 });
          }
          if (draft.status === "APPROVED") return ""; // race fallback; handled after
          if (!draft.encounterId) {
            throw Object.assign(new Error("encounter required"), { code: 409 });
          }

          const items = await tx
            .select()
            .from(prescriptionDraftItems)
            .where(eq(prescriptionDraftItems.draftId, draft.id))
            .orderBy(asc(prescriptionDraftItems.sequenceNumber));
          if (items.length === 0 || items.some((i) => !i.medicineName.trim())) {
            throw Object.assign(new Error("empty prescription"), { code: 409 });
          }

          if (parsed.data.reviewed_items && contentHash(parsed.data.reviewed_items) !== contentHash(
            items.map((i) => ({
              medicine_name: i.medicineName,
              strength: i.strength ?? undefined,
              dose: i.dose ?? undefined,
              route: i.route ?? undefined,
              frequency: i.frequency ?? undefined,
              timing: i.timing ?? undefined,
              duration: i.duration ?? undefined,
              instructions: i.instructions ?? undefined,
            })),
          )) {
            throw Object.assign(new Error("Draft changed after review. Review the latest draft before finalizing."), { code: "DRAFT_CHANGED" });
          }

          const now = new Date();
          const [rx] = await tx
            .insert(prescriptions)
            .values({
              patientId: draft.patientId,
              encounterId: draft.encounterId,
              doctorId,
              status: "ACTIVE",
              createdFromDraftId: draft.id,
            })
            .returning();

          const [ver] = await tx
            .insert(prescriptionVersions)
            .values({
              prescriptionId: rx.id,
              versionNumber: 1,
              finalizedByDoctorId: doctorId,
              finalizedAt: now,
              contentHash: contentHash(
                items.map((i) => ({
                  medicine_name: i.medicineName,
                  strength: i.strength ?? undefined,
                  dose: i.dose ?? undefined,
                  route: i.route ?? undefined,
                  frequency: i.frequency ?? undefined,
                  timing: i.timing ?? undefined,
                  duration: i.duration ?? undefined,
                  instructions: i.instructions ?? undefined,
                })),
              ),
            })
            .returning();

          await tx.insert(prescriptionItems).values(
            items.map((i, idx) => ({
              prescriptionVersionId: ver.id,
              sequenceNumber: idx + 1,
              medicineName: i.medicineName,
              strength: i.strength,
              dose: i.dose,
              route: i.route,
              frequency: i.frequency,
              timing: i.timing,
              duration: i.duration,
              instructions: i.instructions,
            })),
          );

          await tx
            .update(prescriptions)
            .set({ currentVersionId: ver.id, updatedAt: now })
            .where(eq(prescriptions.id, rx.id));
          await tx
            .update(prescriptionDrafts)
            .set({ status: "APPROVED", reviewedAt: now, updatedAt: now })
            .where(eq(prescriptionDrafts.id, draft.id));

          return rx.id;
        });
      } catch (err) {
        if ((err as { code?: string }).code === "DRAFT_CHANGED") {
          return error(request, reply, 409, "DRAFT_CHANGED", (err as Error).message);
        }
        const code = (err as { code?: number }).code;
        if (code === 404) return error(request, reply, 404, "NOT_FOUND", "Draft not found");
        if (code === 403) return error(request, reply, 403, "FORBIDDEN", "Not your draft");
        if (code === 409) {
          return error(request, reply, 409, "DRAFT_FINALIZED", "Draft cannot be finalized");
        }
        throw err;
      }

      if (!prescriptionId) {
        const replay = await loadPrescriptionByDraft(request.params.draft_id, doctorId);
        if (replay) {
          if (parsed.data.reviewed_items && contentHash(parsed.data.reviewed_items) !== contentHash(replay.versions[0].items)) {
            return error(request, reply, 409, "DRAFT_CHANGED", "This draft was finalized with different content. Reopen the prescription to review it.");
          }
          return reply.send(replay);
        }
        return error(request, reply, 409, "DRAFT_FINALIZED", "Draft already finalized");
      }

      const view = await loadPrescriptionView(prescriptionId);
      await logAccess(request, {
        patientId: view!.patient_id,
        purpose: "Prescription finalized",
        resourceType: "PRESCRIPTION",
        resourceId: prescriptionId,
        action: "CREATE",
      });
      return reply.code(201).send(view);
    },
  );

  app.get<{ Params: { prescription_id: string } }>(
    "/doctor/prescriptions/:prescription_id",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const view = await loadPrescriptionView(request.params.prescription_id);
      if (!view) return error(request, reply, 404, "NOT_FOUND", "Prescription not found");
      if (view.doctor_id !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your prescription");
      }
      return view;
    },
  );

  app.post<{ Params: { prescription_id: string } }>(
    "/doctor/prescriptions/:prescription_id/amend",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const parsed = amendPrescriptionSchema.safeParse(request.body);
      if (!parsed.success) {
        return error(request, reply, 400, "VALIDATION_ERROR", "Invalid amend payload");
      }
      const body = parsed.data;

      const database = requireDb();
      const [rx] = await database
        .select()
        .from(prescriptions)
        .where(eq(prescriptions.id, request.params.prescription_id))
        .limit(1);
      if (!rx) return error(request, reply, 404, "NOT_FOUND", "Prescription not found");
      if (rx.doctorId !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your prescription");
      }

      const current = (
        await database
          .select()
          .from(prescriptionVersions)
          .where(eq(prescriptionVersions.id, rx.currentVersionId!))
          .limit(1)
      )[0];
      if (!current) return error(request, reply, 404, "NOT_FOUND", "Current version not found");

      const now = new Date();
      const nextNumber = current.versionNumber + 1;
      const [ver] = await database
        .insert(prescriptionVersions)
        .values({
          prescriptionId: rx.id,
          versionNumber: nextNumber,
          amendmentReason: body.reason,
          finalizedByDoctorId: doctorId,
          finalizedAt: now,
          supersedesVersionId: current.id,
          contentHash: contentHash(body.items),
        })
        .returning();

      await database.insert(prescriptionItems).values(
        body.items.map((it, idx) => ({
          prescriptionVersionId: ver.id,
          sequenceNumber: idx + 1,
          medicineName: it.medicine_name,
          strength: it.strength ?? null,
          dose: it.dose ?? null,
          route: it.route ?? null,
          frequency: it.frequency ?? null,
          timing: it.timing ?? null,
          duration: it.duration ?? null,
          instructions: it.instructions ?? null,
        })),
      );

      await database
        .update(prescriptions)
        .set({ currentVersionId: ver.id, updatedAt: now })
        .where(eq(prescriptions.id, rx.id));

      const view = await loadPrescriptionView(rx.id);
      return reply.code(201).send(view);
    },
  );

  app.post<{ Params: { prescription_id: string } }>(
    "/doctor/prescriptions/:prescription_id/render",
    async (request, reply) => {
      const doctorId = requireDoctor(request, reply);
      if (typeof doctorId !== "string") return doctorId;

      const view = await loadPrescriptionView(request.params.prescription_id);
      if (!view) return error(request, reply, 404, "NOT_FOUND", "Prescription not found");
      if (view.doctor_id !== doctorId) {
        return error(request, reply, 403, "FORBIDDEN", "Not your prescription");
      }

      const doc = await requireDb()
        .select({ registrationNumber: doctors.registrationNumber })
        .from(doctors)
        .where(eq(doctors.id, doctorId))
        .limit(1);
      const names = await patientNames([view.patient_id]);
      const current = view.current_version;

      const pdf = await renderPrescriptionPdf({
        doctorName: current.finalized_by,
        doctorSpeciality: null,
        doctorRegistration: doc[0]?.registrationNumber ?? "",
        patientName: names.get(view.patient_id) ?? "",
        finalizedAt: current.finalized_at,
        versionNumber: current.version_number,
        items: current.items,
      });

      await logAccess(request, {
        patientId: view.patient_id,
        purpose: "Prescription printed",
        resourceType: "PRESCRIPTION",
        resourceId: view.id,
        action: "PRINT",
      });

      reply.header("Content-Type", "application/pdf");
      reply.header(
        "Content-Disposition",
        `inline; filename="prescription-${view.id}-v${current.version_number}.pdf"`,
      );
      return reply.send(pdf);
    },
  );

  app.get<{ Params: { prescription_id: string } }>(
    "/patients/self/prescriptions/:prescription_id",
    async (request, reply) => {
      const patientId = requirePatient(request, reply);
      if (typeof patientId !== "string") return patientId;

      const view = await loadPrescriptionView(request.params.prescription_id);
      // 404 (not 403): avoid leaking the existence of other patients' records.
      if (!view || view.patient_id !== patientId) {
        return error(request, reply, 404, "NOT_FOUND", "Prescription not found");
      }

      await logAccess(request, {
        patientId,
        purpose: "Patient viewed prescription",
        resourceType: "PRESCRIPTION",
        resourceId: view.id,
        action: "VIEW",
      });
      return view;
    },
  );
}

/** Returns a draft's finalized prescription only for its owning doctor. */
async function loadPrescriptionByDraft(draftId: string, doctorId: string): Promise<PrescriptionView | null> {
  const database = requireDb();
  const [rx] = await database
    .select()
    .from(prescriptions)
    .where(and(eq(prescriptions.createdFromDraftId, draftId), eq(prescriptions.doctorId, doctorId)))
    .limit(1);
  return rx ? loadPrescriptionView(rx.id) : null;
}
