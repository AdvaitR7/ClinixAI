import { describe, expect, it } from "vitest";
import type { MeResponse } from "@clinix/schemas";
import { dockForMe, doctorNav } from "@/lib/workspace-nav";

describe("doctorNav", () => {
  it("always lists the same five destinations, Follow-ups included and enabled", () => {
    expect(doctorNav().map((item) => item.label)).toEqual(["Desk", "Schedule", "Patients", "Drafts", "Follow-ups"]);
    expect(doctorNav().find((item) => item.label === "Follow-ups")?.href).toBe("/app/doctor/followups");
  });

  it("marks exactly the requested destination as current", () => {
    const nav = doctorNav("drafts");
    expect(nav.filter((item) => item.active).map((item) => item.label)).toEqual(["Drafts"]);
    expect(doctorNav().some((item) => item.active)).toBe(false);
  });
});

describe("dockForMe", () => {
  const base = { profile_id: "p", patient_id: null, doctor_id: null, verification_status: null, memberships: [] };

  it("gives assistants the Intake tab and receptionists the Patients tab", () => {
    const staff = (role: string) => ({ ...base, role: "CLINIC_STAFF", memberships: [{ member_id: "m", practice_id: "x", practice_name: "C", role }] }) as unknown as MeResponse;
    expect(dockForMe(staff("ASSISTANT"))?.items.map((item) => item.label)).toContain("Intake");
    expect(dockForMe(staff("RECEPTION"))?.items.map((item) => item.label)).toContain("Patients");
  });

  it("returns no dock for a role without a workspace", () => {
    expect(dockForMe({ ...base, role: "UNKNOWN" } as unknown as MeResponse)).toBeNull();
  });
});
