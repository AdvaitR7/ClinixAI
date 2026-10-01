import { checkDb, checkExtensions } from "./db";

const up = await checkDb();
console.log(`db: ${up ? "up" : "down"}`);

if (!up) {
  process.exit(1);
}

const exts = await checkExtensions();
console.log(`extensions: ${exts.join(", ") || "(none)"}`);
console.log(`pgvector: ${exts.includes("vector") ? "PRESENT" : "MISSING"}`);
process.exit(exts.includes("vector") ? 0 : 1);
