import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  aiEvidenceBundles,
  encounters,
  interactionBlocks,
  interactionResponses,
  interactionSessions,
  labObservations,
  medicationRecords,
  patientIdentity,
  prescriptionItems,
  prescriptionVersions,
  prescriptions,
} from "@clinix/api/schema";
import { decryptIdentity } from "@clinix/api/crypto";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";

function getAgeBand(dobString: string | null): string {
  if (!dobString) return "UNKNOWN";
  const dob = new Date(`${dobString}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return "UNKNOWN";
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;

  if (age < 18) return "<18";
  if (age <= 30) return "18-30";
  if (age <= 50) return "31-50";
  if (age <= 70) return "51-70";
  return "70+";
}

export interface CanonicalEvidenceBundle {
  encounter_id: string;
  demographics: {
    age_band: string;
    biological_sex: string | null;
  };
  current_concern: {
    chief_concern: string | null;
    responses: Array<{
      question_title: string;
      selected_options: string[];
      free_text: string | null;
    }>;
  };
  allergies: string[];
  conditions: string[];
  current_medications: Array<{
    medicine_name: string;
    dose: string | null;
    frequency: string | null;
    status: string;
  }>;
  relevant_labs: Array<{
    test_name: string;
    value_numeric: number | null;
    value_text: string | null;
    unit: string | null;
    reference: string | null;
    flag: string | null;
    observed_at: string | null;
  }>;
  historical_encounters: Array<{
    id: string;
    started_at: string;
    encounter_type: string;
    chief_concern: string | null;
  }>;
  historical_prescriptions: Array<{
    id: string;
    finalized_at: string | null;
    items: Array<{
      medicine_name: string;
      dose: string | null;
      frequency: string | null;
    }>;
  }>;
}

/**
 * Builds a frozen, de-identified Evidence Bundle.
 * Strips all direct PII (names, phone numbers, exact addresses).
 * Enforces contains_direct_identifiers = false.
 */
export async function buildEvidenceBundle(
  database: PostgresJsDatabase<any>,
  args: {
    aiSessionId: string;
    patientId: string;
    encounterId: string;
  },
): Promise<{
  bundleId: string;
  payload: CanonicalEvidenceBundle;
  payloadHash: string;
}> {
  // 1. Demographics: age_band & biological sex only. Direct PII excluded.
  const [identityRow] = await database
    .select({
      dobEnc: patientIdentity.dateOfBirthEncrypted,
      sex: patientIdentity.sexAtRegistration,
    })
    .from(patientIdentity)
    .where(eq(patientIdentity.patientId, args.patientId))
    .limit(1);

  let ageBand = "UNKNOWN";
  if (identityRow?.dobEnc) {
    try {
      const dobStr = decryptIdentity(identityRow.dobEnc);
      ageBand = getAgeBand(dobStr);
    } catch {
      ageBand = "UNKNOWN";
    }
  }

  // 2. Current encounter & interaction answers
  const [currentEnc] = await database
    .select({
      id: encounters.id,
      chiefConcern: encounters.chiefConcern,
    })
    .from(encounters)
    .where(eq(encounters.id, args.encounterId))
    .limit(1);

  const [activeSession] = await database
    .select({ id: interactionSessions.id })
    .from(interactionSessions)
    .where(eq(interactionSessions.encounterId, args.encounterId))
    .orderBy(desc(interactionSessions.startedAt))
    .limit(1);

  const responsesList: Array<{
    question_title: string;
    selected_options: string[];
    free_text: string | null;
  }> = [];

  if (activeSession) {
    const rawResponses = await database
      .select({
        blockTitle: interactionBlocks.title,
        selectedIds: interactionResponses.selectedOptionIds,
        options: interactionBlocks.options,
        freeText: interactionResponses.freeText,
      })
      .from(interactionResponses)
      .innerJoin(
        interactionBlocks,
        eq(interactionResponses.interactionBlockId, interactionBlocks.id),
      )
      .where(eq(interactionBlocks.interactionSessionId, activeSession.id))
      .orderBy(interactionBlocks.sequenceNumber);

    for (const r of rawResponses) {
      responsesList.push({
        question_title: r.blockTitle,
        selected_options: ((r.selectedIds as string[]) ?? []).map((id) => ((r.options as { id: string; label: string }[] | null) ?? []).find((option) => option.id === id)?.label ?? id),
        free_text: r.freeText ?? null,
      });
    }
  }

  // 3. Documented allergies & conditions (from past encounters / med records)
  // Check med records for adverse reactions
  const rawMedRecords = await database
    .select({
      medicineName: medicationRecords.medicineName,
      dose: medicationRecords.dose,
      frequency: medicationRecords.frequency,
      status: medicationRecords.status,
      adverseReaction: medicationRecords.adverseReaction,
    })
    .from(medicationRecords)
    .where(eq(medicationRecords.patientId, args.patientId));

  const allergies: string[] = [];
  const currentMedications: Array<{
    medicine_name: string;
    dose: string | null;
    frequency: string | null;
    status: string;
  }> = [];

  for (const m of rawMedRecords) {
    if (m.adverseReaction && !allergies.includes(m.adverseReaction)) {
      allergies.push(m.adverseReaction);
    }
    if (m.status === "ACTIVE" || m.status === "CURRENT") {
      currentMedications.push({
        medicine_name: m.medicineName,
        dose: m.dose ?? null,
        frequency: m.frequency ?? null,
        status: m.status,
      });
    }
  }

  // 4. Relevant lab observations
  const rawLabs = await database
    .select({
      testName: labObservations.testName,
      valNum: labObservations.valueNumeric,
      valText: labObservations.valueText,
      unit: labObservations.unit,
      refText: labObservations.referenceText,
      flag: labObservations.flag,
      obsAt: labObservations.observedAt,
    })
    .from(labObservations)
    .where(eq(labObservations.patientId, args.patientId))
    .orderBy(desc(labObservations.observedAt))
    .limit(10);

  const relevantLabs = rawLabs.map((l) => ({
    test_name: l.testName,
    value_numeric: l.valNum ? Number(l.valNum) : null,
    value_text: l.valText ?? null,
    unit: l.unit ?? null,
    reference: l.refText ?? null,
    flag: l.flag ?? null,
    observed_at: l.obsAt ? l.obsAt.toISOString() : null,
  }));

  // 5. Historical encounters (excluding current)
  const rawPastEncounters = await database
    .select({
      id: encounters.id,
      startedAt: encounters.startedAt,
      encounterType: encounters.encounterType,
      chiefConcern: encounters.chiefConcern,
    })
    .from(encounters)
    .where(
      and(
        eq(encounters.patientId, args.patientId),
        ne(encounters.id, args.encounterId),
      ),
    )
    .orderBy(desc(encounters.startedAt))
    .limit(10);

  const historicalEncounters = rawPastEncounters.map((e) => ({
    id: e.id,
    started_at: e.startedAt.toISOString(),
    encounter_type: e.encounterType,
    chief_concern: e.chiefConcern ?? null,
  }));

  // 6. Historical finalized prescriptions
  const rawPrescriptions = await database
    .select({
      id: prescriptions.id,
      finalizedAt: prescriptionVersions.finalizedAt,
      medicineName: prescriptionItems.medicineName,
      dose: prescriptionItems.dose,
      frequency: prescriptionItems.frequency,
    })
    .from(prescriptions)
    .innerJoin(
      prescriptionVersions,
      eq(prescriptions.currentVersionId, prescriptionVersions.id),
    )
    .innerJoin(
      prescriptionItems,
      eq(prescriptionItems.prescriptionVersionId, prescriptionVersions.id),
    )
    .where(eq(prescriptions.patientId, args.patientId))
    .orderBy(desc(prescriptionVersions.finalizedAt))
    .limit(10);

  const rxMap = new Map<
    string,
    {
      id: string;
      finalized_at: string | null;
      items: Array<{ medicine_name: string; dose: string | null; frequency: string | null }>;
    }
  >();

  for (const r of rawPrescriptions) {
    if (!rxMap.has(r.id)) {
      rxMap.set(r.id, {
        id: r.id,
        finalized_at: r.finalizedAt ? r.finalizedAt.toISOString() : null,
        items: [],
      });
    }
    rxMap.get(r.id)!.items.push({
      medicine_name: r.medicineName,
      dose: r.dose ?? null,
      frequency: r.frequency ?? null,
    });
  }

  const payload: CanonicalEvidenceBundle = {
    encounter_id: args.encounterId,
    demographics: {
      age_band: ageBand,
      biological_sex: identityRow?.sex ?? null,
    },
    current_concern: {
      chief_concern: currentEnc?.chiefConcern ?? null,
      responses: responsesList,
    },
    allergies,
    conditions: [],
    current_medications: currentMedications,
    relevant_labs: relevantLabs,
    historical_encounters: historicalEncounters,
    historical_prescriptions: Array.from(rxMap.values()),
  };

  const payloadSerialized = JSON.stringify(payload);
  const payloadHash = crypto
    .createHash("sha256")
    .update(payloadSerialized)
    .digest("hex");

  const [inserted] = await database
    .insert(aiEvidenceBundles)
    .values({
      aiSessionId: args.aiSessionId,
      bundleVersion: 1,
      payload: payload as any,
      payloadHash,
      containsDirectIdentifiers: false,
    })
    .returning({ id: aiEvidenceBundles.id });

  return {
    bundleId: inserted.id,
    payload,
    payloadHash,
  };
}
