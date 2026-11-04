// Rasterises the CliniX mark into the PWA icon PNGs using the Playwright Chromium already installed.
// Usage: node scripts/generate-icons.mjs   (writes public/icons/*.png; commit the output)
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const BOTANICAL = "#12352C";
const PAPER = "#F7F2E9";
const outDir = fileURLToPath(new URL("../public/icons/", import.meta.url));

/**
 * Builds the SVG for one icon.
 * @param {number} size - Output size in px.
 * @param {number} glyphScale - Fraction of the canvas the glyph occupies (smaller for maskable safe zone).
 * @param {number} radius - Corner radius as a fraction of size (0 = full-bleed square).
 */
function iconSvg(size, glyphScale, radius) {
  const glyph = size * glyphScale;
  const offset = (size - glyph) / 2;
  const r = size * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" rx="${r}" fill="${BOTANICAL}"/>
  <g transform="translate(${offset} ${offset}) scale(${glyph / 24})">
    <path d="M12 2.5c.65 5.3 4.2 8.85 9.5 9.5-5.3.65-8.85 4.2-9.5 9.5C11.35 16.2 7.8 12.65 2.5 12 7.8 11.35 11.35 7.8 12 2.5Z" fill="${PAPER}"/>
  </g>
</svg>`;
}

const targets = [
  { file: "192.png", size: 192, glyph: 0.6, radius: 0.22 },
  { file: "512.png", size: 512, glyph: 0.6, radius: 0.22 },
  // Maskable icons keep the glyph inside the central 80% safe zone and fill the full square.
  { file: "maskable-512.png", size: 512, glyph: 0.5, radius: 0 },
  // iOS applies its own rounding, so the apple icon is full-bleed.
  { file: "apple-180.png", size: 180, glyph: 0.6, radius: 0 },
];

await mkdir(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const { file, size, glyph, radius } of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${iconSvg(size, glyph, radius)}`);
  const png = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  await writeFile(`${outDir}${file}`, png);
  console.log(`wrote public/icons/${file}`);
}
await browser.close();
