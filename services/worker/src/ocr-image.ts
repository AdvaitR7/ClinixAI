import sharp from "sharp";

/** Builds a bounded, uncropped OCR input while leaving the stored original untouched. */
export async function prepareOcrImage(bytes: Buffer, mimeType: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return { bytes, mimeType };
  const image = sharp(bytes);
  const metadata = await image.metadata();
  if ((metadata.width ?? 0) <= 2560 && (metadata.height ?? 0) <= 2560 && bytes.length <= 1_000_000) {
    return { bytes, mimeType };
  }
  const prepared = await image.rotate()
    .resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer();
  return { bytes: prepared, mimeType: "image/jpeg" };
}
