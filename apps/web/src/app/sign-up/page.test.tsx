import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SignUpPage from "./page";

const mocks = vi.hoisted(() => ({ signUp: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ status: "signed-out", signUp: mocks.signUp, resendConfirmation: vi.fn() }),
}));

describe("signup failures", () => {
  it.each(["user_already_exists", "email_exists"])("offers sign-in and recovery for %s", async (code) => {
    mocks.signUp.mockRejectedValueOnce({ code, message: "User already registered", status: 422 });
    render(<SignUpPage />);
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "existing@example.test" } });
    fireEvent.change(screen.getByLabelText("Password", { exact: true }), { target: { value: "Synthetic-password1!" } });
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "Synthetic-password1!" } });
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("An account with this email already exists. Sign in or reset your password.");
    expect(screen.getByRole("link", { name: "Sign in to your account" })).toHaveAttribute("href", "/sign-in");
    expect(screen.getByRole("link", { name: "Reset your password" })).toHaveAttribute("href", "/forgot-password");
  });
});
