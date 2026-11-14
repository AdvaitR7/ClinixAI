import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AuthShell } from "@/components/auth-shell";
import { ClinicalReviewDialog } from "@/components/clinical-review-dialog";
import { VaultDialog } from "@/components/vault-dialog";
import { WorkspaceShell } from "@/components/workspace-shell";

vi.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { email: "synthetic@example.test" }, signOut: vi.fn() }) }));
vi.mock("@/lib/api", () => ({ useApiData: () => ({ status: "ready", data: [] }) }));
vi.mock("@/components/install-app", () => ({ useInstallState: () => ({ available: false }) }));

const nav = [
  { label: "Home", href: "/app/patient", active: true },
  { label: "Timeline", href: "/app/patient/timeline" },
  { label: "Vault", href: "/app/patient/vault" },
  { label: "Care", href: "/app/patient/care" },
  { label: "Medications", href: "/app/patient/medications", disabled: true },
];

// JSDOM has no native dialog lifecycle; real focus containment is checked in Chromium.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

describe("WorkspaceShell appearance", () => {
  it("stays legacy by default", () => {
    const { container } = render(<WorkspaceShell workspace="Patient" title="Today" nav={nav}>body</WorkspaceShell>);
    expect(container.querySelector("[data-ui='clear']")).toBeNull();
  });

  it("keeps every destination, the active state and the disabled state in Clear", () => {
    const { container } = render(<WorkspaceShell appearance="clear" workspace="Patient" title="Today" nav={nav}>body</WorkspaceShell>);
    expect(container.querySelector("[data-ui='clear']")).not.toBeNull();
    const dock = screen.getByRole("navigation", { name: "Patient workspace" });
    for (const item of nav) expect(dock).toHaveTextContent(item.label);
    expect(screen.getByRole("link", { name: "Home" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Timeline" })).toHaveAttribute("href", "/app/patient/timeline");
    expect(screen.queryByRole("link", { name: "Medications" })).toBeNull();
    expect(screen.getByText("Medications").closest("[aria-disabled='true']")).not.toBeNull();
  });

  it("never renders a dark shell for a doctor workspace in Clear", () => {
    const { container } = render(<WorkspaceShell appearance="clear" workspace="Doctor" title="Desk" nav={nav}>body</WorkspaceShell>);
    expect(container.firstElementChild?.className).not.toContain("bg-ink");
  });

  it("keeps account, notifications and the heading available in Clear", () => {
    render(<WorkspaceShell appearance="clear" workspace="Patient" title="Today" nav={nav}>body</WorkspaceShell>);
    expect(screen.getByRole("heading", { name: "Today" })).toBeInTheDocument();
    expect(screen.getByLabelText("Account options")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Notifications" })).toHaveAttribute("href", "/notifications");
  });
});

describe("AuthShell appearance", () => {
  it("renders the same content in both appearances", () => {
    const { rerender, container } = render(<AuthShell eyebrow="Account" title="Sign in" orientation="Use your email">form</AuthShell>);
    expect(container.querySelector("[data-ui='clear']")).toBeNull();
    rerender(<AuthShell appearance="clear" eyebrow="Account" title="Sign in" orientation="Use your email">form</AuthShell>);
    expect(container.querySelector("[data-ui='clear']")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("form")).toBeInTheDocument();
  });
});

describe("Clear dialogs keep their interaction model", () => {
  it("ClinicalReviewDialog closes via Close but not while busy", () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <ClinicalReviewDialog appearance="clear" titleId="t" busy={false} onClose={onClose} returnFocusRef={ref}><h2 id="t">Review</h2></ClinicalReviewDialog>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    rerender(
      <ClinicalReviewDialog appearance="clear" titleId="t" busy onClose={onClose} returnFocusRef={ref}><h2 id="t">Review</h2></ClinicalReviewDialog>,
    );
    expect(screen.getByRole("button", { name: "Close" })).toBeDisabled();
    fireEvent(document.querySelector("dialog")!, new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("VaultDialog ignores Escape and backdrop clicks while busy", () => {
    const onClose = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(<VaultDialog appearance="clear" titleId="v" busy returnFocusRef={ref} onClose={onClose}><h2 id="v">Source</h2></VaultDialog>);
    const dialog = document.querySelector("dialog")!;
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute("data-ui", "clear");
  });

  it("legacy dialogs carry no Clear marker", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<VaultDialog titleId="v" returnFocusRef={ref} onClose={vi.fn()}><h2 id="v">Source</h2></VaultDialog>);
    expect(document.querySelector("dialog")).not.toHaveAttribute("data-ui");
  });
});
