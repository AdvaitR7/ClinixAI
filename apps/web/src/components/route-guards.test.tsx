import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireOnboarding, RequireSession, RequireWorkspace } from "@/components/route-guards";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  auth: { status: "signed-in", isLoaded: true, identityVersion: 0 },
  me: { status: "ready", me: { role: "PATIENT" }, refresh: vi.fn() },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/auth", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/lib/api", () => ({ useMe: () => mocks.me }));

/** Holds a synthetic private draft so the account-switch boundary can be checked. */
function PrivateDraft() {
  const [value, setValue] = useState("");
  return <input aria-label="Private draft" value={value} onChange={(event) => setValue(event.target.value)} />;
}

describe("protected application access", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.auth = { status: "signed-in", isLoaded: true, identityVersion: 0 };
    mocks.me = { status: "ready", me: { role: "PATIENT" }, refresh: vi.fn() };
  });

  it("does not render protected content during password recovery", () => {
    mocks.auth.status = "recovery";
    render(<RequireSession><p>Private content</p></RequireSession>);
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/reset-password");
  });

  it("clears private local state when the authenticated identity changes", () => {
    const view = render(<RequireWorkspace role="PATIENT"><PrivateDraft /></RequireWorkspace>);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Synthetic private note" } });
    mocks.auth.identityVersion += 1;
    view.rerender(<RequireWorkspace role="PATIENT"><PrivateDraft /></RequireWorkspace>);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("redirects a different role without rendering the requested workspace", () => {
    mocks.me.me.role = "DOCTOR";
    render(<RequireWorkspace role="PATIENT"><p>Patient workspace</p></RequireWorkspace>);
    expect(screen.queryByText("Patient workspace")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/app/doctor");
  });

  it("fails safely for an unsupported application role", () => {
    mocks.me.me.role = "ADMIN";
    render(<RequireWorkspace role="PATIENT"><p>Private content</p></RequireWorkspace>);
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
    expect(screen.getByText("Access unavailable")).toBeInTheDocument();
  });

  it("does not let an existing profile enter another role's onboarding", () => {
    mocks.me.me.role = "DOCTOR";
    render(<RequireOnboarding><p>New patient form</p></RequireOnboarding>);
    expect(screen.queryByText("New patient form")).not.toBeInTheDocument();
    expect(mocks.replace).toHaveBeenCalledWith("/app/doctor");
  });

  it("keeps onboarding and claim entry available without a profile", () => {
    mocks.me.status = "needs-onboarding";
    render(<RequireOnboarding><p>Claim entry</p></RequireOnboarding>);
    expect(screen.getByText("Claim entry")).toBeInTheDocument();
  });

  it("requires a supported role for shared settings", () => {
    mocks.me.me.role = "ADMIN";
    render(<RequireWorkspace><p>Account settings</p></RequireWorkspace>);
    expect(screen.queryByText("Account settings")).not.toBeInTheDocument();
    expect(screen.getByText("Access unavailable")).toBeInTheDocument();
  });
});
