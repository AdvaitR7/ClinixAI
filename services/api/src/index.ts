import Fastify from "fastify";
import { checkDb } from "./db";

const app = Fastify({ logger: true });

// Health is a root-level ops endpoint. Domain routes use the /api/v1 prefix
// starting in Phase 1 (see CLAUDE.md architectural invariant).
app.get("/health", async () => {
  const up = await checkDb();
  return { ok: true, db: up ? "up" : "down" };
});

const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? "0.0.0.0";

try {
  await app.listen({ port, host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
