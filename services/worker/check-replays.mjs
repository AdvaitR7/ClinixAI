import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Fails when a recorded replay contains something that looks like a name, phone number or email.
// Run before committing ai/replays/: node check-replays.mjs
const ROOT = new URL("./ai/replays/", import.meta.url).pathname;
const PATTERNS = [
  ["phone number", /\+\d[\d\s-]{9,}\d|\b[6-9]\d{9}\b/],
  ["email address", /[\w.+-]+@[\w-]+\.[\w.-]+/],
  ["persona or doctor name", /Ananya|Krishnan|Rohan|Mehta|Sunita|Verma|Kavita|Rao\b|Priya|Nair|Imran|Qureshi/i],
  ["patient name label", /patient\s*name|name\s*:/i],
];

/** Lists every .json replay file below a directory. */
function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".json") ? [path] : [];
  });
}

let bad = 0;
const all = files(ROOT);
for (const file of all) {
  const text = readFileSync(file, "utf8");
  for (const [label, re] of PATTERNS) {
    const hit = text.match(re);
    if (hit) {
      bad++;
      console.error(`${file.replace(ROOT, "")}: possible ${label}: "${hit[0]}"`);
    }
  }
}
console.log(`${all.length} replay file(s) checked, ${bad} finding(s)`);
process.exit(bad ? 1 : 0);
