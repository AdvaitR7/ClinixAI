import OpenAI from "openai";
import { readFileSync } from "node:fs";
import { ocrPrescriptionSchema, ocrLabReportSchema } from "@clinix/schemas";

const client = new OpenAI({ baseURL: process.env.NINEROUTER_BASE_URL, apiKey: process.env.NINEROUTER_API_KEY });

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

async function run(label, mime, filePath, prompt, schema) {
  const b64 = readFileSync(filePath).toString("base64");
  const res = await client.chat.completions.create({
    model: process.env.MODEL_ROUTE_OCR,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: [{ type: "text", text: "Extract the document into the requested JSON schema." }, { type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } }]},
    ],
    response_format: { type: "json_object" },
  });
  let s = (res.choices[0]?.message?.content ?? "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const parsed = JSON.parse(s);
  const ok = schema.safeParse(parsed);
  console.log(`\n=== ${label} === schema-valid: ${ok.success}`);
  if (!ok.success) console.log("issues:", JSON.stringify(ok.error.issues.slice(0,4)));
  console.log(JSON.stringify(parsed, null, 1).slice(0, 1200));
}

await run("Rx PNG", "image/png", "/media/machine/00041E0A041E02F8/Project/ClinixAI/services/api/fixtures/rx_synthetic.png", PRESCRIPTION_PROMPT, ocrPrescriptionSchema);
await run("Lab PDF", "application/pdf", "/media/machine/00041E0A041E02F8/Project/ClinixAI/services/api/fixtures/lab_synthetic.pdf", LAB_PROMPT, ocrLabReportSchema);
