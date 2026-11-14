import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MedicineEditor, type EditorItem } from "@/components/medicine-editor";
import { clearPrivacyCard, privacyCard } from "@/lib/privacy";
import { clearScheduleCard, scheduleCard } from "@/lib/doctor-schedule";

const flagged: EditorItem[] = [{ medicine_name: "Synthetic medicine", dose: "1 tab", needs_review: true, reviewed: true, confidence: 0.4 }];

describe("MedicineEditor in Clear appearance", () => {
  it("uses the light surface and 16px Clear fields but keeps every label", () => {
    const { container } = render(<MedicineEditor appearance="clear" items={flagged} onChange={vi.fn()} />);
    expect(container.querySelector(".clinix-doctor-card")).toBeNull();
    expect(container.querySelector(".clear-card")).not.toBeNull();
    expect(screen.getByLabelText("Medicine name")).toHaveClass("clear-field");
    expect(screen.getByLabelText("Dose (e.g. 1 tab)")).toBeInTheDocument();
  });

  it("still clears the reviewed confirmation when a flagged value changes", () => {
    const onChange = vi.fn();
    render(<MedicineEditor appearance="clear" items={flagged} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Dose (e.g. 1 tab)"), { target: { value: "2 tabs" } });
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ dose: "2 tabs", reviewed: false })]);
  });

  it("keeps the ambiguity warning and confirmation checkbox", () => {
    render(<MedicineEditor appearance="clear" items={flagged} onChange={vi.fn()} />);
    expect(screen.getByText(/ambiguous/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /checked medication 1 against the source/i })).toBeChecked();
  });

  it("defaults to the unchanged legacy look", () => {
    const { container } = render(<MedicineEditor appearance="legacy" items={flagged} onChange={vi.fn()} />);
    expect(container.querySelector(".clinix-doctor-card")).not.toBeNull();
  });
});

describe("Clear constants", () => {
  it("resolve to the opaque Clear surface", () => {
    expect(privacyCard).toContain("clear-card");
    expect(scheduleCard).toContain("clear-card");
    expect(clearPrivacyCard).toBe(privacyCard);
    expect(clearScheduleCard).toBe(scheduleCard);
  });
});
