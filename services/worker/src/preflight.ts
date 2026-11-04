import "dotenv/config";
import OpenAI from "openai";
import { gatewayBaseUrl, type ModelRole } from "./gateway.js";

const requiredRoutes: Record<Exclude<ModelRole, "STT">, string> = {
  ANALYST_1: "MODEL_ROUTE_ANALYST_1",
  ANALYST_2: "MODEL_ROUTE_ANALYST_2",
  JUDGE: "MODEL_ROUTE_JUDGE",
  OCR: "MODEL_ROUTE_OCR",
};

/** Checks 9Router authentication, configured model IDs, and a real JSON chat response. */
async function main() {
  const baseURL = gatewayBaseUrl(process.env.NINEROUTER_BASE_URL);
  const apiKey = process.env.NINEROUTER_API_KEY;
  if (!apiKey) throw new Error("NINEROUTER_API_KEY is missing");

  const routes = Object.fromEntries(
    Object.entries(requiredRoutes).map(([role, variable]) => [role, process.env[variable]?.trim()]),
  ) as Record<keyof typeof requiredRoutes, string | undefined>;
  const missing = Object.entries(routes).filter(([, value]) => !value).map(([role]) => role);
  if (missing.length) throw new Error(`Model routes are missing for: ${missing.join(", ")}`);

  const client = new OpenAI({ baseURL, apiKey, timeout: 15_000, maxRetries: 0 });
  const models = await client.models.list();
  const modelIds = new Set(models.data.map((model) => model.id));
  const unavailable = Object.entries(routes)
    .filter(([, model]) => !modelIds.has(model!))
    .map(([role, model]) => `${role}=${model}`);
  if (unavailable.length) throw new Error(`Configured routes are not present in 9Router: ${unavailable.join(", ")}`);

  const response = await client.chat.completions.create({
    model: routes.ANALYST_1!,
    stream: false,
    messages: [
      { role: "system", content: "Return a JSON object with one key named ok whose value is true." },
      { role: "user", content: "Return the requested object." },
    ],
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  });
  const content = response.choices[0]?.message?.content;
  if (!content || JSON.parse(content).ok !== true) throw new Error("The 9Router structured-response check failed");

  console.log(`9Router preflight passed: ${Object.keys(routes).length} routes found and JSON completion succeeded.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown 9Router preflight error";
  const safeMessage = process.env.NINEROUTER_API_KEY ? message.replaceAll(process.env.NINEROUTER_API_KEY, "[redacted]") : message;
  console.error(`9Router preflight failed: ${safeMessage}`);
  process.exitCode = 1;
});
