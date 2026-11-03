import { expect, it } from "vitest";
import { clinicDay } from "./clinic-day.js";

it("switches clinic dates at midnight IST rather than midnight UTC", () => {
  expect(clinicDay(new Date("2026-11-02T18:29:59Z"))).toBe("2026-11-02");
  expect(clinicDay(new Date("2026-11-02T18:30:00Z"))).toBe("2026-11-03");
  expect(clinicDay(new Date("2026-12-31T18:30:00Z"))).toBe("2027-01-01");
});
