import type { FastifyInstance } from "fastify";
import { requirePatient } from "../auth/guards.js";
import { medicationsForPatient } from "./derive.js";

/** GET /patients/self/medications (API §27). */
export async function medicationRoutes(app: FastifyInstance) {
  app.get("/patients/self/medications", async (request, reply) => {
    const patientId = requirePatient(request, reply);
    if (typeof patientId !== "string") return patientId;
    return { medications: await medicationsForPatient(patientId) };
  });
}
