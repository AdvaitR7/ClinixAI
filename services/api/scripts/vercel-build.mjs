// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

/**
 * Vercel-only build step for the API.
 *
 * Vercel compiles the API's own TypeScript, but ships workspace packages from node_modules as-is.
 * `@clinix/schemas` exports raw `src/index.ts`, and Node refuses to load TypeScript from
 * node_modules, so every request crashed with ERR_MODULE_NOT_FOUND. This step compiles the package
 * to `dist/index.js` and points its `exports` there, inside the Vercel build container only.
 *
 * `zod` stays external so the API and the schemas share one zod instance (ZodError instanceof checks).
 * Guarded by the `VERCEL` env var so a local run can never rewrite the tracked package.json.
 */
async function main() {
  if (!process.env.VERCEL) {
    throw new Error("vercel-build.mjs only runs inside a Vercel build (VERCEL is unset).");
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const schemasDir = path.resolve(here, "../../../packages/schemas");

  await build({
    entryPoints: [path.join(schemasDir, "src/index.ts")],
    outfile: path.join(schemasDir, "dist/index.js"),
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["zod"],
    logLevel: "info",
  });

  const manifestPath = path.join(schemasDir, "package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // The bundle is ESM; declaring it avoids Node re-parsing the file on every cold start.
  manifest.type = "module";
  manifest.main = "./dist/index.js";
  manifest.exports = { ".": { types: "./src/index.ts", default: "./dist/index.js" } };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("@clinix/schemas now resolves to dist/index.js for this deployment");
}

await main();
