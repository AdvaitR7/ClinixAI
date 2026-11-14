import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { Skeleton } from "@/components/skeleton";
import { StatusBadge } from "@/components/status-badge";

describe("StatusBadge tones", () => {
  it.each([
    ["CONFIRMED", "positive"],
    ["UNPAID", "review"],
    ["UNKNOWN_STATUS", "review"],
    ["NO_SHOW", "urgent"],
    ["COMPLETED", "neutral"],
  ])("maps %s to the %s tone", (status, tone) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(status.replace(/_/g, " "))).toHaveAttribute("data-tone", tone);
  });

  it("keeps an unrecognised status neutral and still shows its text", () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    const badge = screen.getByText("SOMETHING NEW");
    expect(badge).toHaveAttribute("data-tone", "neutral");
  });

  it("never turns a prescribed or unknown state into a positive one", () => {
    render(<StatusBadge status="UNKNOWN_STATUS" />);
    expect(screen.getByText("UNKNOWN STATUS")).not.toHaveAttribute("data-tone", "positive");
  });
});

describe("ConfidenceBadge tones", () => {
  it("shows low confidence as a review state with explicit text", () => {
    render(<ConfidenceBadge value={0.1} />);
    const badge = screen.getByText(/low confidence/i);
    expect(badge).toHaveAttribute("data-tone", "review");
  });

  it("shows high confidence as positive", () => {
    render(<ConfidenceBadge value={0.99} />);
    expect(screen.getByText(/high confidence/i)).toHaveAttribute("data-tone", "positive");
  });
});

describe("Skeleton", () => {
  it("stays hidden from assistive technology", () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
