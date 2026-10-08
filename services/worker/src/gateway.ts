import OpenAI from "openai";
import type { z } from "zod";

/** Roles map to pinned 9Router routes from env (ARCHITECTURE_SPEC §34). */
export type ModelRole = "ANALYST_1" | "ANALYST_2" | "JUDGE" | "OCR" | "STT";

const ROUTE_ENV: Record<ModelRole, string> = {
  ANALYST_1: "MODEL_ROUTE_ANALYST_1",
  ANALYST_2: "MODEL_ROUTE_ANALYST_2",
  JUDGE: "MODEL_ROUTE_JUDGE",
  OCR: "MODEL_ROUTE_OCR",
  STT: "MODEL_ROUTE_STT",
};

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | unknown[];
};

/** Strips ```json / ``` markdown fences that some routes emit despite json_object. */
function extractJson(content: string): string {
  let s = content.trim();
  const fence = s.match(/^```(?:json)?\s*/i);
  if (fence) s = s.slice(fence[0].length);
  s = s.replace(/```\s*$/, "").trim();
  return s;
}

/**
 * NineRouterGateway — OpenAI SDK pointed at 9Router's OpenAI-compatible base URL.
 * Model label ("Gemini 3.8 Flash High" etc.) lives only in comments; the pinned
 * route is what actually routes. Throws on non-JSON or schema failure so the
 * caller's job retries.
 */
export async function generateStructured<T>(args: {
  role: ModelRole;
  schema: z.ZodType<T>;
  messages: ChatMessage[];
}): Promise<T> {
  const route = process.env[ROUTE_ENV[args.role]];
  if (!route) throw new Error(`Missing model route for role ${args.role}`);

  const client = new OpenAI({
    baseURL: process.env.NINEROUTER_BASE_URL,
    apiKey: process.env.NINEROUTER_API_KEY,
  });

  // ponytail: response_format json_object + manual parse, not zodResponseFormat's
  // json_schema — upgrade if 9Router gains native structured output.
  const res = await client.chat.completions.create({
    model: route,
    messages: args.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(extractJson(content));
  return args.schema.parse(parsed);
}
