import "dotenv/config";
import { PgBoss } from "pg-boss";
import { execFileSync } from "node:child_process";

/** Checks configured routes, then proves a persistent job completes on the target worker revision. */
async function main() {
  execFileSync(process.execPath, ["--import", "tsx", "src/preflight.ts"], { stdio: "inherit" });
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, max: 1 });
  boss.on("error", () => console.error("Deployment probe queue unavailable"));
  await boss.start();
  try {
    await boss.createQueue("ops.probe");
    const id = await boss.send("ops.probe", { revision: process.env.GIT_SHA }, { retryLimit: 0, expireInSeconds: 90 });
    if (!id) throw new Error("Could not enqueue deployment probe");
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const job = await boss.getJobById("ops.probe", id);
      if (job?.state === "completed") {
        const output = job.output as { ok?: boolean; revision?: string };
        if (output.ok !== true || output.revision !== process.env.GIT_SHA) throw new Error("Invalid probe result");
        console.log("Deployment probe passed: queue, worker revision and structured AI response.");
        return;
      }
      if (job?.state === "failed") throw new Error("Synthetic worker probe failed");
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    throw new Error("Synthetic worker probe timed out");
  } finally {
    await boss.stop({ graceful: true, timeout: 5000 });
  }
}
main().catch(() => { console.error("Deployment verification failed; inspect restricted service logs."); process.exitCode = 1; });
