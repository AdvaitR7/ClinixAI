import type { FastifyInstance } from "fastify";
import { createEncounterSchema } from "@clinix/schemas";
import { requirePatient } from "../auth/guards.js";
import { error, requireDb } from "../http.js";
import { encounters } from "../schema.js";

/** POST /patients/self/encounters — patient-initiated encounter (API spec §8). */
export async function encounterRoutes(app: FastifyInstance) {
  app.post("/patients/self/encounters", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;

    const parsed = createEncounterSchema.safeParse(request.body);
    if (!parsed.success) {
      return error(request, reply, 400, "VALIDATION_ERROR", "Invalid encounter payload");
    }
    const body = parsed.data;

    const database = requireDb();
    const inserted = await database
      .insert(encounters)
      .values({
        patientId,
        encounterType: body.encounter_type,
        status: "OPEN",
        chiefConcern: body.chief_concern ?? null,
        initiatedByActorType: "PATIENT",
        initiatedByActorId: request.auth.profileId,
      })
      .returning({ id: encounters.id });

    return reply.code(201).send({ encounter_id: inserted[0].id });
  });
}
