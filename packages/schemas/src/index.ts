import { z } from "zod";

// Shared health-status vocabulary — the Phase 0 proof that web + api can both
// import one schema package (the monorepo's "shared contract").
export const healthStatusSchema = z.enum([
  "stable",
  "needs_attention",
  "critical",
]);

export type HealthStatus = z.infer<typeof healthStatusSchema>;
