import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import PatientPage from "./page";

vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main> }));
vi.mock("@/lib/api", () => ({
  useApiData: () => ({ status: "ready", data: {
    upcoming_appointment: { scheduled_start: "2026-11-05T07:00:00Z", reason: "Clinic visit", status: "CONFIRMED" },
    pending_followups: [], recent_timeline: [],
  } }),
}));

afterEach(() => vi.useRealTimers());

it("labels the upcoming visit with its own date rather than today's date", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-04T06:00:00Z"));
  render(<PatientPage />);
  expect(screen.getByRole("heading", { name: "Next appointment" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Thursday, 5 November" })).toBeInTheDocument();
  expect(screen.getByText(/12:30/)).toBeInTheDocument();
});
