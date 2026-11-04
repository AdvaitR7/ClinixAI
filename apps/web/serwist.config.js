// @ts-check
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { serwist } from "@serwist/next/config";

// Versions the precached offline page so a new release replaces the old copy.
const revision = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() || randomUUID();

// Configurator mode builds public/sw.js after `next build`, so no Next route handler is needed.
export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // Only static assets and the offline page are precached; pages themselves stay network-only.
  precachePrerendered: false,
  additionalPrecacheEntries: [{ url: "/~offline", revision }],
});
