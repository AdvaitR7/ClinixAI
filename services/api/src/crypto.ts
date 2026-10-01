import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const keyHex = process.env.IDENTITY_ENCRYPTION_KEY ?? "";

function key(): Buffer {
  const buf = Buffer.from(keyHex, "hex");
  if (buf.length !== 32) {
    throw new Error(
      "IDENTITY_ENCRYPTION_KEY must be 32 bytes as 64 hex chars (openssl rand -hex 32)",
    );
  }
  return buf;
}

// ponytail: one key reused for AES-GCM + HMAC; split into IDENTITY_HASH_KEY
// (via HKDF) only if a security review ever asks for primitive separation.

/** AES-256-GCM: returns iv(12) ‖ authTag(16) ‖ ciphertext. */
export function encryptIdentity(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

export function decryptIdentity(blob: Buffer): string {
  const iv = blob.subarray(0, 12);
  const authTag = blob.subarray(12, 28);
  const ciphertext = blob.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    "utf8",
  );
}

/** Deterministic keyed hash for duplicate detection (DB spec §5.2). */
export function hashIdentity(value: string): string {
  return createHmac("sha256", key()).update(value, "utf8").digest("hex");
}
