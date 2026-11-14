import { expect, it } from "vitest";
import sharp from "sharp";
import { prepareOcrImage } from "./ocr-image.js";

it("bounds large camera images without cropping or changing the original bytes", async () => {
  const original = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "white" } }).png().toBuffer();
  const copy = Buffer.from(original);
  const result = await prepareOcrImage(original, "image/png");
  const metadata = await sharp(result.bytes).metadata();
  expect([metadata.width, metadata.height]).toEqual([2560, 1920]);
  expect(result.mimeType).toBe("image/jpeg");
  expect(original.equals(copy)).toBe(true);
});

it("preserves small images and leaves non-image document handling unchanged", async () => {
  const small = await sharp({ create: { width: 200, height: 300, channels: 3, background: "white" } }).png().toBuffer();
  expect((await prepareOcrImage(small, "image/png")).bytes).toBe(small);
  const pdf = Buffer.from("synthetic PDF bytes");
  expect(await prepareOcrImage(pdf, "application/pdf")).toEqual({ bytes: pdf, mimeType: "application/pdf" });
});
