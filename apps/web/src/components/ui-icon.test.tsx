import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ClinixBrand } from "@/components/clinix-brand";
import { UiIcon } from "@/components/ui-icon";

describe("UiIcon", () => {
  it("hides decorative icons from assistive technology", () => {
    const { container } = render(<UiIcon name="search" />);
    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("exposes a labelled icon as an image", () => {
    render(<UiIcon name="bell" label="Notifications" />);
    expect(screen.getByRole("img", { name: "Notifications" })).toBeInTheDocument();
  });

  it("renders the requested size and inherits colour", () => {
    const { container } = render(<UiIcon name="plus" size={14} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "14");
    expect(svg).toHaveAttribute("stroke", "currentColor");
  });
});

describe("ClinixBrand", () => {
  it("keeps the legacy mark by default", () => {
    const { container } = render(<ClinixBrand />);
    expect(container.querySelector("[data-brand='clear']")).toBeNull();
    expect(screen.getByLabelText("ClinixAI")).toBeInTheDocument();
  });

  it("renders the Clear plus mark only when requested", () => {
    const { container } = render(<ClinixBrand appearance="clear" />);
    expect(container.querySelector("[data-brand='clear']")).not.toBeNull();
    expect(screen.getByLabelText("ClinixAI")).toBeInTheDocument();
  });
});
