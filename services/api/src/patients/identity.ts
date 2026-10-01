import { decryptIdentity, encryptIdentity, hashIdentity } from "../crypto.js";

/** Server-enforced 18+ (SCREEN_CATALOG Page 2; CONTEXT §2 adults 18+). */
export function isAdult(dateOfBirth: string): boolean {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return false;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age >= 18;
}

/** Encrypts identifying fields into the patient_identity insert shape (DB spec §5.2). */
export function encryptPatientIdentity(body: {
  full_name: string;
  phone: string;
  date_of_birth: string;
  sex_at_registration: string;
}) {
  return {
    fullNameEncrypted: encryptIdentity(body.full_name),
    phoneEncrypted: encryptIdentity(body.phone),
    phoneHash: hashIdentity(body.phone),
    dateOfBirthEncrypted: encryptIdentity(body.date_of_birth),
    sexAtRegistration: body.sex_at_registration,
  };
}

/** Single place that knows the patient_identity blob layout. Never leaks blobs to clients. */
export function decryptMinimal(row: {
  fullNameEncrypted: Buffer;
  phoneEncrypted: Buffer;
  dateOfBirthEncrypted: Buffer | null;
  sexAtRegistration: string | null;
}) {
  return {
    full_name: decryptIdentity(row.fullNameEncrypted),
    phone: decryptIdentity(row.phoneEncrypted),
    date_of_birth: row.dateOfBirthEncrypted
      ? decryptIdentity(row.dateOfBirthEncrypted)
      : null,
    sex_at_registration: row.sexAtRegistration,
  };
}
