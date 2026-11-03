import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let stopping = false;

/** Stops only this launcher's process groups, including Next.js descendants. */
function stop(code) {
  if (stopping) return;
  stopping = true;
  console.log("\nStopping ClinixAI…");
  for (const child of children) signalGroup(child, "SIGTERM");
  setTimeout(() => {
    for (const child of children) signalGroup(child, "SIGKILL");
    process.exit(code);
  }, 3000);
}

/** Signals an owned process group without touching other development servers. */
function signalGroup(child, signal) {
  if (!child.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if (error.code !== "ESRCH") console.error(`Could not stop process (${error.code}).`);
  }
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

/** Rejects occupied ports before starting anything; never silently changes ports. */
async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", () => reject(new Error(`Port ${port} is in use. Stop its server before running ./run.sh.`)));
    server.listen(port, "0.0.0.0", () => server.close(resolve));
  });
}

/** Starts a service with bounded crash recovery and visible, prefixed output. */
function launch(name, directory, args, env) {
  const service = { ready: false, attempts: 0 };
  /** Restarts the actual service process rather than a watcher that can hide crashes. */
  function start() {
    if (stopping) return;
    service.ready = false;
    const child = spawn(process.execPath, args, {
      cwd: path.join(root, directory), env, detached: true, stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    createInterface({ input: child.stdout }).on("line", (line) => {
      console.log(`[${name}] ${line}`);
      if (name === "worker" && line.includes("worker: listening")) service.ready = true;
    });
    child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
    child.on("error", () => { console.error(`${name} could not start.`); stop(1); });
    child.on("exit", (code, signal) => {
      // Next can leave descendants behind when its parent exits.
      signalGroup(child, "SIGTERM");
      children.delete(child);
      service.ready = false;
      if (stopping) return;
      if (++service.attempts > 3) {
        console.error(`${name} keeps exiting (${signal ?? code}). Stopping all services.`);
        stop(1);
        return;
      }
      console.error(`${name} exited (${signal ?? code}); restarting in 2 seconds (${service.attempts}/3).`);
      setTimeout(start, 2000);
    });
  }
  start();
  return service;
}

/** Waits for actual readiness, with a deadline and abortable HTTP probes. */
async function waitFor(name, probe) {
  const deadline = Date.now() + 120_000;
  while (!stopping && Date.now() < deadline) {
    try { if (await probe()) return; } catch { /* Service is still starting. */ }
    await delay(500);
  }
  if (!stopping) throw new Error(`${name} was not ready within 120 seconds. Check its output above.`);
}

/** Validates configuration and starts API → worker → web on fixed local ports. */
async function main() {
  if (process.argv.length > 2) throw new Error("Usage: ./run.sh (web: 12455, API: 12456)");
  if (Number(process.versions.node.split(".")[0]) < 24) throw new Error("Node.js 24 or newer is required.");
  if (!existsSync(path.join(root, "node_modules/next/dist/bin/next"))) throw new Error("Dependencies are missing. Run npm ci first.");
  const { parse } = await import("dotenv");
  /** Reads dotenv as data, never as executable shell commands, and checks required names. */
  function configuration(file, required) {
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) throw new Error(`Missing ${file}; copy its .env.example and fill in your settings.`);
    const env = { ...parse(readFileSync(absolute)), ...process.env, NODE_ENV: "development" };
    const missing = required.filter((key) => !env[key]?.trim());
    if (missing.length) throw new Error(`${file}: missing ${missing.join(", ")}`);
    return env;
  }
  const apiEnv = configuration("services/api/.env", ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_JWT_VERIFICATION_MODE"]);
  const workerEnv = configuration("services/worker/.env", ["DATABASE_URL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  const webEnv = configuration("apps/web/.env.local", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  await checkPort(12455);
  await checkPort(12456);
  const origin = "http://localhost:12455";
  Object.assign(apiEnv, { PORT: "12456", HOST: "0.0.0.0", CORS_ORIGINS: `${origin},http://127.0.0.1:12455` });
  Object.assign(webEnv, {
    NEXT_PUBLIC_API_BASE_URL: "http://localhost:12456/api/v1",
    NEXT_PUBLIC_AUTH_REDIRECT_BASE_URL: origin,
  });
  console.log("Starting ClinixAI: API → worker → web. Ctrl+C stops everything.");
  launch("api", "services/api", ["--import", "tsx", "src/index.ts"], apiEnv);
  await waitFor("API and database", async () => {
    const response = await fetch("http://127.0.0.1:12456/health", { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.json()).db === "up";
  });
  if (stopping) return;
  const worker = launch("worker", "services/worker", ["--import", "tsx", "src/index.ts"], workerEnv);
  await waitFor("Worker", () => worker.ready);
  if (stopping) return;
  launch("web", "apps/web", [path.join(root, "node_modules/next/dist/bin/next"), "dev", "--hostname", "0.0.0.0", "--port", "12455"], webEnv);
  await waitFor("Web", async () => (await fetch(`${origin}/sign-in`, { signal: AbortSignal.timeout(5000) })).ok);
  if (!stopping) console.log(`\nClinixAI ready: ${origin}\nAPI: http://localhost:12456 • Database: connected • Worker: ready\n`);
}

main().catch((error) => {
  console.error(`Startup failed: ${error.message}`);
  stop(1);
});
