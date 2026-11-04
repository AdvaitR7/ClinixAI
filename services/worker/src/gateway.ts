import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Adds the OpenAI-compatible API path exactly once for 9Router deployments. */
export function gatewayBaseUrl(value: string | undefined): string {
  if (!value) throw new Error("NINEROUTER_BASE_URL is not configured");
  const base = new URL(value);
  if (base.protocol !== "https:" && base.hostname !== "localhost") {
    throw new Error("NINEROUTER_BASE_URL must use HTTPS outside local development");
  }
  base.pathname = `${base.pathname.replace(/\/+$/, "").replace(/\/v1$/i, "")}/v1`;
  base.search = "";
  base.hash = "";
  return base.toString().replace(/\/$/, "");
}

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

/** Where canned demo outputs live: services/worker/ai/replays/<role>/<key>.json. */
const REPLAY_DIR = new URL("../ai/replays/", import.meta.url);

/** `DEMO_REPLAY` modes: unset is the live gateway, `replay` serves canned files, `record` saves live successes. */
function replayMode(): "off" | "replay" | "record" {
  const mode = process.env.DEMO_REPLAY?.trim().toLowerCase();
  return mode === "replay" || mode === "record" ? mode : "off";
}

/** Replay keys are hex digests; anything else is refused so a key can never escape the replay directory. */
function replayFile(role: ModelRole, key: string): URL | null {
  return /^[a-f0-9]{16,64}$/.test(key) ? new URL(`${role}/${key}.json`, REPLAY_DIR) : null;
}

/** Deterministic replay key: sha256 hex of any JSON-serialisable value (object bytes, ordered answers). */
export function replayKeyOf(value: string | Buffer | unknown): string {
  const data = typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value);
  return createHash("sha256").update(data).digest("hex");
}

export type StructuredResult<T> = { value: T; source: "live" | "replay" };

/**
 * NineRouterGateway: OpenAI SDK pointed at 9Router's OpenAI-compatible base URL.
 * Model label ("Gemini 3.8 Flash High" etc.) lives only in comments; the pinned
 * route is what actually routes. Throws on non-JSON or schema failure so the
 * caller's job retries.
 *
 * Demo replay (opt-in via `DEMO_REPLAY`): with `replay` and a matching `replayKey` file the canned
 * output is returned after `schema.parse` (so it is still validated); with `record` a live success is
 * saved to that file; a missing key falls back to the live call. Unset behaves exactly as before.
 * Callers use `source` to label replayed runs honestly.
 */
export async function generateStructuredTracked<T>(args: {
  role: ModelRole;
  schema: z.ZodType<T>;
  messages: ChatMessage[];
  /** Deterministic key for the canned output of this call (see `replayKeyOf`). */
  replayKey?: string;
}): Promise<StructuredResult<T>> {
  const mode = replayMode();
  const file = args.replayKey ? replayFile(args.role, args.replayKey) : null;

  if (mode === "replay" && file && existsSync(file)) {
    return { value: args.schema.parse(JSON.parse(readFileSync(file, "utf8"))), source: "replay" };
  }

  const route = process.env[ROUTE_ENV[args.role]];
  if (!route) throw new Error(`Missing model route for role ${args.role}`);
  if (!process.env.NINEROUTER_API_KEY) throw new Error("NINEROUTER_API_KEY is not configured");

  const client = new OpenAI({
    baseURL: gatewayBaseUrl(process.env.NINEROUTER_BASE_URL),
    apiKey: process.env.NINEROUTER_API_KEY,
  });

  // ponytail: response_format json_object + manual parse, not zodResponseFormat's
  // json_schema; upgrade if 9Router gains native structured output.
  const res = await client.chat.completions.create({
    model: route,
    messages: args.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
    reasoning_effort: "low",
    response_format: { type: "json_object" },
  });

  const content = res.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(extractJson(content));
  const value = args.schema.parse(parsed);

  if (mode === "record" && file) {
    mkdirSync(new URL("./", file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  }
  return { value, source: "live" };
}

/** Same as `generateStructuredTracked` for callers that do not need to know whether the output was replayed. */
export async function generateStructured<T>(args: Parameters<typeof generateStructuredTracked<T>>[0]): Promise<T> {
  return (await generateStructuredTracked(args)).value;
}
