"use client";

import { useCallback } from "react";
import { useAuth } from "@/lib/auth";
import { fetchApi } from "@/lib/api";

export type StaffRole = "RECEPTION" | "ASSISTANT";

export type StaffAppointment = {
  id: string;
  patient_name: string;
  scheduled_start: string;
  reason: string | null;
  status: string;
  payment_status: string;
  appointment_type: string;
  intake_status: "ARRIVED" | "WAITING" | "READY_FOR_DOCTOR" | null;
};

export type StaffDashboard = {
  practice: { id: string; name: string };
  role: "OWNER" | "DOCTOR" | StaffRole;
  counts: { requested: number; waiting: number; unpaid: number; contact: number };
  appointments: StaffAppointment[];
  assigned_followups: { id: string; patient_name: string; reason: string; due_at: string; contact_status: string }[];
};

export type Vitals = {
  id: string;
  temperature_c: number | null;
  pulse_bpm: number | null;
  systolic_mmhg: number | null;
  diastolic_mmhg: number | null;
  spo2_percent: number | null;
  weight_kg: number | null;
  needs_doctor_review: boolean;
  provenance: string;
  recorded_at: string;
};

export type StaffIntake = {
  appointment_id: string;
  patient_name: string;
  scheduled_start: string;
  reason: string | null;
  intake_status: StaffAppointment["intake_status"];
  clinical_intake_locked: boolean;
  intake_note?: string | null;
  vitals: Vitals[];
};

export type FollowupView = {
  id: string;
  patient_name: string;
  practice_id: string | null;
  due_at: string;
  reason: string;
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  assigned_member_id: string | null;
  contact_status: "UNREACHED" | "REACHED";
  outcome: string | null;
};

export type TeamMember = {
  member_id: string;
  display_name: string | null;
  contact_hint: string | null;
  role: "OWNER" | "DOCTOR" | "RECEPTION" | "ASSISTANT";
  status: "INVITED" | "ACTIVE" | "SUSPENDED" | "FORMER" | "REVOKED" | "EXPIRED";
  invite_expires_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
};

/** Returns an authenticated writer for POST/PATCH/PUT calls so pages stay free of token plumbing. */
export function useApiWrite() {
  const { getToken } = useAuth();
  return useCallback(
    async <T,>(path: string, method: "POST" | "PATCH" | "PUT", body: unknown = {}): Promise<T> => {
      const token = await getToken();
      if (!token) throw new Error("Authentication required");
      return fetchApi<T>(token, path, { method, body: JSON.stringify(body) });
    },
    [getToken],
  );
}

/** Formats an ISO time for the clinic's timezone. */
export function clinicTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" });
}

/** Formats an ISO date for the clinic's timezone. */
export function clinicDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });
}

const PRACTICE_KEY = "clinix.staff.activePractice";

/** Remembers the staff member's chosen practice on this device. */
export function rememberPractice(practiceId: string) {
  try {
    window.localStorage.setItem(PRACTICE_KEY, practiceId);
  } catch {
    /* storage unavailable: selection lasts for this page only */
  }
}

/** Resolves the active practice: explicit choice, then the remembered one, then the first membership. */
export function pickPractice(choice: string | null, practiceIds: string[]): string | null {
  if (choice && practiceIds.includes(choice)) return choice;
  let stored: string | null = null;
  try {
    stored = typeof window === "undefined" ? null : window.localStorage.getItem(PRACTICE_KEY);
  } catch {
    stored = null;
  }
  return stored && practiceIds.includes(stored) ? stored : practiceIds[0] ?? null;
}
