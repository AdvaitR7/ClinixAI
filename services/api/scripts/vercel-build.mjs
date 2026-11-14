// @ts-check
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const STD_FONT_CALL = /require\$1\('#standard-fonts\/(\w+)'\)/g;

/**
 * Makes pdfkit's standard fonts visible to Vercel's file tracer.
 *
 * pdfkit (used by @react-pdf/renderer for prescription PDFs) loads its 14 standard fonts through
 * `createRequire(...)('#standard-fonts/Name')`, a package.json `imports` alias the tracer does not
 * follow, so the deployed function crashed with "Cannot find module .../Helvetica.cjs". This rewrites
 * those calls in the build container's copy only: the CJS build gets literal relative `require`s and
 * the ESM build gets static imports. Both resolve to the same font objects as before.
 *
 * @param {string} jsDir - pdfkit's `js/` directory.
 * @returns {Promise<number>} How many font references were rewritten (28 expected: 14 per build).
 */
async function patchPdfkitFonts(jsDir) {
  let rewritten = 0;

  const cjsPath = path.join(jsDir, "pdfkit.js");
  const cjs = await readFile(cjsPath, "utf8");
  const patchedCjs = cjs.replace(STD_FONT_CALL, (_match, name) => {
    rewritten += 1;
    return `require('./standard-fonts/${name}.cjs')`;
  });
  await writeFile(cjsPath, patchedCjs);

  const esmPath = path.join(jsDir, "pdfkit.node.mjs");
  const esm = await readFile(esmPath, "utf8");
  /** @type {string[]} */
  const imports = [];
  const patchedEsm = esm.replace(STD_FONT_CALL, (_match, name) => {
    rewritten += 1;
    imports.push(`import __clinixStdFont_${name} from './standard-fonts/${name}.mjs';`);
    return `__clinixStdFont_${name}`;
  });
  await writeFile(esmPath, `${imports.join("\n")}\n${patchedEsm}`);

  return rewritten;
}

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

  // Resolve pdfkit the way @react-pdf/renderer does, so the patched copy is the one actually loaded.
  const renderer = createRequire(import.meta.url).resolve("@react-pdf/renderer");
  const pdfkitMain = createRequire(renderer).resolve("pdfkit");
  const pdfkitJs = path.dirname(pdfkitMain);
  const count = await patchPdfkitFonts(pdfkitJs);
  // Vercel can restore node_modules from the build cache with the patch already applied (0 rewrites).
  const esmNow = await readFile(path.join(pdfkitJs, "pdfkit.node.mjs"), "utf8");
  const alreadyPatched = count === 0 && esmNow.includes("__clinixStdFont_Helvetica") && !/require\$1\('#standard-fonts\//.test(esmNow);
  if (count !== 28 && !alreadyPatched) {
    throw new Error(`Expected 28 pdfkit standard-font references, rewrote ${count}; pdfkit layout changed.`);
  }
  console.log(alreadyPatched ? "pdfkit: already patched (cached node_modules)" : `pdfkit: rewrote ${count} standard-font references`);
}

await main();
