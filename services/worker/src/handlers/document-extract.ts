import { createClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import {
  needsReviewByConfidence,
  ocrLabReportSchema,
  ocrPrescriptionSchema,
} from "@clinix/schemas";
import {
  accessEvents,
  documentExtractions,
  documents,
  labObservations,
  labReports,
  prescriptionDraftItems,
  prescriptionDrafts,
} from "@clinix/api/schema";
import { requireDb } from "../db.js";
import { generateStructuredTracked, replayKeyOf } from "../gateway.js";

const BUCKET = "clinix-documents";

function str(v: number | null | undefined): string | null {
  return v == null ? null : String(v);
}

/** Out-of-range flag derived from the reference range, when present. */
function computeFlag(
  value: number | null,
  low: number | null,
  high: number | null,
): string | null {
  if (value == null) return null;
  if (low != null && value < low) return "LOW";
  if (high != null && value > high) return "HIGH";
  return null;
}

async function downloadObject(key: string): Promise<Buffer> {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
  const { data, error } = await client.storage.from(BUCKET).download(key);
  if (error) throw error;
  return Buffer.from(await data.arrayBuffer());
}

function visionMessages(
  system: string,
  dataUrl: string,
): { role: "system" | "user"; content: string | unknown[] }[] {
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: "Extract the document into the requested JSON schema." },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];
}

const PRESCRIPTION_PROMPT = `You are a clinical document OCR extractor. Return STRICT JSON only, in EXACTLY this shape (flat string/number fields — do NOT wrap values in {value, confidence} objects):
{
  "raw_text": "full visible text",
  "medicines": [
    { "medicine_name": "Amoxicillin", "strength": "500 mg", "dose": "1 tablet", "route": null, "frequency": "three times daily", "timing": null, "duration": "5 days", "instructions": null, "confidence": 0.99 }
  ],
  "overall_confidence": 0.9,
  "risk_flags": ["dosage ambiguity"]
}
Rules: medicine_name is required for each medicine. confidence and overall_confidence are numbers 0-1. Use null for missing text fields. Extract only what is visible; never invent. Do not include patient names, phone numbers, or addresses.`;

const LAB_PROMPT = `You are a clinical document OCR extractor. Return STRICT JSON only, in EXACTLY this shape (flat fields — do NOT wrap values in objects):
{
  "raw_text": "full visible text",
  "laboratory_name": "Sinha Diagnostics",
  "collection_date": "2026-09-01",
  "report_date": null,
  "observations": [
    { "test_name": "HbA1c", "value_numeric": 6.1, "value_text": null, "unit": "%", "reference_text": "4.0 - 5.6", "confidence": 0.99 }
  ]
}
Rules: put numeric results in value_numeric as a number (leave value_text null); put non-numeric results in value_text (leave value_numeric null). reference_text is the full reference range string. confidence is a number 0-1. Use null for missing fields. Extract only what is visible; never invent. Do not include patient names, phone numbers, or addresses.`;

/** Splits a reference range string ("4.0 - 5.6", "< 200", "> 40") into bounds. */
function parseReference(ref: string | null): { low: number | null; high: number | null } {
  if (!ref) return { low: null, high: null };
  const s = ref.trim();
  const lt = s.match(/^<\s*=?\s*([0-9.]+)/);
  if (lt) return { low: null, high: Number(lt[1]) };
  const gt = s.match(/^>\s*=?\s*([0-9.]+)/);
  if (gt) return { low: Number(gt[1]), high: null };
  const m = s.match(/([0-9.]+)\s*[-–—]\s*([0-9.]+)/);
  if (m) return { low: Number(m[1]), high: Number(m[2]) };
  return { low: null, high: null };
}

/**
 * `document.extract` — OCR pipeline. Loads the source object, runs Gemini vision
 * via 9Router, and routes the result by document_type. OCR output is ALWAYS a
 * draft (NEEDS_REVIEW); this handler never finalizes a prescription.
 */
export async function handleDocumentExtract(jobs: { data: { documentId: string } }[]): Promise<void> {
  for (const job of jobs) {
    await extractDocument(job.data.documentId);
  }
}

async function extractDocument(documentId: string): Promise<void> {
  const database = requireDb();

  const [doc] = await database
    .select()
    .from(documents)
    .where(eq(documents.id, documentId))
    .limit(1);
  if (!doc || doc.deletedAt) return;
  if (doc.processingStatus === "COMPLETE" || doc.processingStatus === "NEEDS_REVIEW") return;

  // Only lab + prescription documents are OCR'd in Phase 4. Other document types
  // are stored but not auto-extracted (ponytail: add imaging/discharge parsers
  // when a screen asks for them).
  if (doc.documentType !== "LAB_REPORT" && doc.documentType !== "PRESCRIPTION") {
    await database
      .update(documents)
      .set({ processingStatus: "COMPLETE" })
      .where(eq(documents.id, documentId));
    return;
  }

  try {
    const bytes = await downloadObject(doc.storageObjectKey);
    const dataUrl = `data:${doc.mimeType};base64,${bytes.toString("base64")}`;
    // Stable for the synthetic fixtures: the same file bytes always map to the same canned output.
    const replayKey = replayKeyOf(bytes);

    if (doc.documentType === "LAB_REPORT") {
      const run = await generateStructuredTracked({
        role: "OCR",
        schema: ocrLabReportSchema,
        messages: visionMessages(LAB_PROMPT, dataUrl),
        replayKey,
      });
      const extraction = run.value;
      await database.insert(documentExtractions).values({
        documentId,
        extractorType: run.source === "replay" ? "replay:ninerouter-gemini-flash" : "ninerouter-gemini-flash",
        rawText: extraction.raw_text,
        structuredPayload: extraction,
        confidence: null,
        status: "SUCCEEDED",
      });

      const [report] = await database
        .insert(labReports)
        .values({
          patientId: doc.patientId,
          documentId,
          encounterId: doc.encounterId,
          laboratoryName: extraction.laboratory_name,
          collectionDate: extraction.collection_date ?? null,
          reportDate: extraction.report_date ?? null,
        })
        .returning();

      let anyLow = false;
      for (const obs of extraction.observations) {
        if (needsReviewByConfidence(obs.confidence)) anyLow = true;
        const value = obs.value_numeric;
        const { low, high } = parseReference(obs.reference_text);
        await database.insert(labObservations).values({
          labReportId: report.id,
          patientId: doc.patientId,
          testCode: null,
          testName: obs.test_name,
          valueNumeric: str(value),
          valueText: obs.value_text,
          unit: obs.unit,
          referenceLow: str(low),
          referenceHigh: str(high),
          referenceText: obs.reference_text,
          flag: computeFlag(value, low, high),
          confidence: str(obs.confidence),
          observedAt: extraction.collection_date
            ? new Date(`${extraction.collection_date}T00:00:00Z`)
            : new Date(),
        });
      }

      await database
        .update(documents)
        .set({ processingStatus: anyLow ? "NEEDS_REVIEW" : "COMPLETE" })
        .where(eq(documents.id, documentId));
    } else {
      // PRESCRIPTION — paper Rx photo.
      const run = await generateStructuredTracked({
        role: "OCR",
        schema: ocrPrescriptionSchema,
        messages: visionMessages(PRESCRIPTION_PROMPT, dataUrl),
        replayKey,
      });
      const extraction = run.value;
      await database.insert(documentExtractions).values({
        documentId,
        extractorType: run.source === "replay" ? "replay:ninerouter-gemini-flash" : "ninerouter-gemini-flash",
        rawText: extraction.raw_text,
        structuredPayload: extraction,
        confidence: str(extraction.overall_confidence),
        status: "SUCCEEDED",
      });

      // A draft needs a doctor; patient-uploaded Rx photos store the extraction only
      // (ponytail: §38 manual OCR→draft trigger unnecessary while doctor uploads
      // auto-draft; add if patient-uploaded Rx→draft becomes a real flow).
      if (doc.uploadedByActorType === "DOCTOR" && doc.uploadedByActorId) {
        const [draft] = await database
          .insert(prescriptionDrafts)
          .values({
            patientId: doc.patientId,
            encounterId: doc.encounterId,
            doctorId: doc.uploadedByActorId,
            source: "OCR",
            status: "NEEDS_REVIEW",
            sourceDocumentId: documentId,
            overallConfidence: str(extraction.overall_confidence),
            riskFlags: extraction.risk_flags,
            rawExtraction: extraction,
          })
          .returning();

        await database.insert(prescriptionDraftItems).values(
          extraction.medicines.map((m, i) => ({
            draftId: draft.id,
            sequenceNumber: i + 1,
            medicineName: m.medicine_name,
            strength: m.strength,
            dose: m.dose,
            route: m.route,
            frequency: m.frequency,
            timing: m.timing,
            duration: m.duration,
            instructions: m.instructions,
            fieldConfidence: { confidence: m.confidence },
            needsReview: needsReviewByConfidence(m.confidence),
          })),
        );
        await database
          .update(documents)
          .set({ processingStatus: "NEEDS_REVIEW" })
          .where(eq(documents.id, documentId));
      } else {
        await database
          .update(documents)
          .set({ processingStatus: "COMPLETE" })
          .where(eq(documents.id, documentId));
      }
    }

    // Append-only ledger. logAccess() needs a FastifyRequest, so the worker
    // inserts directly (ponytail: same columns, no update/delete path).
    await database.insert(accessEvents).values({
      patientId: doc.patientId,
      actorType: "AI_SERVICE",
      actorId: null,
      purpose: "OCR extraction",
      resourceType: "DOCUMENT",
      resourceId: documentId,
      action: "OCR_EXTRACT",
    });
  } catch (err) {
    // Mark FAILED and rethrow so pg-boss retries (a later success overwrites the
    // status); if all retries fail the document stays FAILED.
    await database
      .update(documents)
      .set({ processingStatus: "FAILED" })
      .where(eq(documents.id, documentId));
    throw err;
  }
}
