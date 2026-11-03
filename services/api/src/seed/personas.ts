/** Synthetic demo personas. Every email uses the reserved demo domain; nothing here is real PII. */
export const DEMO_DOMAIN = "demo.clinix.test";

export type AccountSpec = { key: string; email: string; displayName: string; role: string };

export const DOCTOR: AccountSpec & { registrationNumber: string; authority: string; qualification: string; speciality: string } = {
  key: "doctor",
  email: `kavita.rao@${DEMO_DOMAIN}`,
  displayName: "Dr. Kavita Rao",
  role: "Doctor (owner)",
  registrationNumber: "DEMO-REG-0001",
  authority: "Demo Medical Council (synthetic)",
  qualification: "MBBS, MD (General Medicine)",
  speciality: "General Medicine",
};

export const PRACTICE_NAME = "Rao Family Clinic (demo)";

export const RECEPTIONIST: AccountSpec = {
  key: "reception",
  email: `priya.nair@${DEMO_DOMAIN}`,
  displayName: "Priya Nair",
  role: "Receptionist",
};

export const ASSISTANT: AccountSpec = {
  key: "assistant",
  email: `imran.qureshi@${DEMO_DOMAIN}`,
  displayName: "Imran Qureshi",
  role: "Clinic assistant",
};

export type PatientSpec = AccountSpec & { phone: string; dob: string; sex: string };

/** Persona A: respiratory history with an amoxicillin reaction. Matches the ARCHITECTURE_SPEC canonical demo. */
export const PATIENT_A: PatientSpec = {
  key: "patient-a",
  email: `ananya.krishnan@${DEMO_DOMAIN}`,
  displayName: "Ananya Krishnan",
  role: "Patient A (respiratory)",
  phone: "+919000000101",
  dob: "1988-03-14",
  sex: "FEMALE",
};

/** Persona B: metabolic record with an HbA1c trend and current metformin. */
export const PATIENT_B: PatientSpec = {
  key: "patient-b",
  email: `rohan.mehta@${DEMO_DOMAIN}`,
  displayName: "Rohan Mehta",
  role: "Patient B (metabolic)",
  phone: "+919000000102",
  dob: "1979-08-22",
  sex: "MALE",
};

/** Persona C: minimal record; the chest-pain check-in is scripted live in the runbook. */
export const PATIENT_C: PatientSpec = {
  key: "patient-c",
  email: `sunita.verma@${DEMO_DOMAIN}`,
  displayName: "Sunita Verma",
  role: "Patient C (red flag)",
  phone: "+919000000103",
  dob: "1992-11-05",
  sex: "FEMALE",
};

export const ALL_ACCOUNTS: AccountSpec[] = [DOCTOR, RECEPTIONIST, ASSISTANT, PATIENT_A, PATIENT_B, PATIENT_C];

/** Marker chief concerns: a persona's history is skipped when its marker encounter already exists. */
export const MARKERS = {
  a: "Cough and low-grade fever for five days",
  b: "Type 2 diabetes follow-up",
  c: "Routine health review",
} as const;
