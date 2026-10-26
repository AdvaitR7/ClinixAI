import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import PrescriptionDraftPage from "@/app/app/doctor/prescription-drafts/[draftId]/page";
import ConsultationPage from "@/app/app/doctor/consultation/[appointmentId]/page";

const mocks = vi.hoisted(() => ({ getToken: vi.fn(), fetchApi: vi.fn(), replace: vi.fn(), refresh: vi.fn(), state: {} as Record<string, unknown> }));
vi.mock("@/lib/auth", () => ({ useAuth: () => ({ getToken: mocks.getToken }) }));
vi.mock("next/navigation", () => ({ useParams: () => ({ draftId: "synthetic-draft", appointmentId: "synthetic-appointment" }), useRouter: () => ({ replace: mocks.replace, push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/api", () => ({ fetchApi: mocks.fetchApi, useApiData: () => ({ ...mocks.state, refresh: mocks.refresh }) }));
vi.mock("@/components/workspace-shell", () => ({ WorkspaceShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));

/** Resolves a controlled write so save/finalize ordering can be asserted. */
function deferred() {
  let resolve!: (value?: unknown) => void;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

const draft = { patient_name: "Synthetic Patient", source: "DIRECT_ENTRY", status: "DRAFT", items: [{ medicine_name: "Synthetic medicine", dose: "1 tablet" }] };
const context = { encounter_id: "synthetic-encounter", appointment: { patient_name: "Synthetic Patient", scheduled_start: "2026-10-25T09:00:00Z", appointment_type: "IN_PERSON", payment_status: "UNPAID", status: "CONFIRMED" }, note: { assessment: "Original assessment" }, note_is_final: false, current_medications: [] };

// JSDOM has no native dialog lifecycle; real focus containment is checked in Chromium.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getToken.mockResolvedValue("synthetic-token");
  mocks.refresh.mockResolvedValue(undefined);
});

describe("prescription review and finalization", () => {
  beforeEach(() => { mocks.state = { status: "ready", data: draft }; });

  it("saves unsaved edits before review and finalizes the exact saved snapshot", async () => {
    const save = deferred();
    mocks.fetchApi.mockImplementation((_token: string, _path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") return save.promise;
      if (init?.method === "POST") return { id: "synthetic-prescription" };
      return { ...draft, items: [{ medicine_name: "Synthetic medicine", dose: "2 tablets" }] };
    });
    render(<PrescriptionDraftPage />);
    fireEvent.change(screen.getByLabelText("Dose (e.g. 1 tab)"), { target: { value: "2 tablets" } });
    fireEvent.click(screen.getByRole("button", { name: "Finalize prescription" }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dose (e.g. 1 tab)")).toBeDisabled();
    save.resolve();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("2 tablets")).toBeVisible();
    const finalize = within(dialog).getByRole("button", { name: "Finalize prescription" });
    expect(finalize).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText("Allergies and current medicines reviewed with the patient"));
    fireEvent.click(within(dialog).getByLabelText("Printable preview checked"));
    expect(finalize).toBeEnabled();
    fireEvent.click(finalize);
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/app/doctor/prescriptions/synthetic-prescription"));
    const request = mocks.fetchApi.mock.calls.find((call) => call[2]?.method === "POST")!;
    expect(JSON.parse(request[2].body)).toEqual({ reviewed_items: [{ medicine_name: "Synthetic medicine", dose: "2 tablets" }] });
  });

  it("keeps edits and does not open review when saving fails", async () => {
    mocks.fetchApi.mockRejectedValue(new Error("Synthetic save failure"));
    render(<PrescriptionDraftPage />);
    fireEvent.change(screen.getByLabelText("Dose (e.g. 1 tab)"), { target: { value: "2 tablets" } });
    fireEvent.click(screen.getByRole("button", { name: "Finalize prescription" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic save failure");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Dose (e.g. 1 tab)")).toHaveValue("2 tablets");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("blocks final review until every flagged extracted medicine is explicitly confirmed", async () => {
    const flagged = { ...draft, source: "OCR", items: [{ medicine_name: "Naproxen", dose: "5? mg", needs_review: true, field_confidence: { confidence: 0.4 } }] };
    mocks.state = { status: "ready", data: flagged };
    let confirmed = false;
    mocks.fetchApi.mockImplementation((_token: string, _path: string, init?: RequestInit) => {
      if (init?.method === "PATCH") { confirmed = JSON.parse(init.body as string).items[0].reviewed === true; return {}; }
      return { ...flagged, items: [{ ...flagged.items[0], needs_review: !confirmed }] };
    });
    render(<PrescriptionDraftPage />);
    expect(screen.getByText(/Confidence 40%/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Finalize prescription" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirm 1 flagged medicine against the source");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("I checked medication 1 against the source"));
    fireEvent.click(screen.getByRole("button", { name: "Finalize prescription" }));
    const dialog = await screen.findByRole("dialog");
    const patches = mocks.fetchApi.mock.calls.filter((call) => call[2]?.method === "PATCH").map((call) => JSON.parse(call[2].body).items[0].reviewed);
    expect(patches).toEqual([false, true]);
    expect(within(dialog).getByLabelText("Medicines match the original source")).not.toBeChecked();
  });

  it("does not silently drop an incomplete medication row", async () => {
    render(<PrescriptionDraftPage />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add another medicine" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize prescription" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Check every medicine name");
    expect(mocks.fetchApi).not.toHaveBeenCalled();
  });
});

describe("consultation completion and amendment", () => {
  beforeEach(() => { mocks.state = { status: "ready", data: context }; });

  it("waits for a delayed latest save before completing and sends the reviewed note", async () => {
    const save = deferred();
    mocks.fetchApi.mockImplementation((_token: string, _path: string, init?: RequestInit) => init?.method === "PUT" ? save.promise : Promise.resolve({ ok: true }));
    render(<ConsultationPage />);
    fireEvent.change(screen.getByLabelText("Assessment"), { target: { value: "Latest assessment" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete consultation" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete consultation" }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
    expect(mocks.fetchApi.mock.calls[0][2].method).toBe("PUT");
    expect(screen.getByLabelText("Assessment")).toBeDisabled();
    save.resolve();
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(2));
    expect(JSON.parse(mocks.fetchApi.mock.calls[1][2].body)).toEqual({ reviewed_note: { assessment: "Latest assessment" } });
  });

  it("retains text and allows a retry when the final save fails", async () => {
    mocks.fetchApi.mockRejectedValueOnce(new Error("Synthetic note failure")).mockResolvedValue({ ok: true });
    render(<ConsultationPage />);
    fireEvent.change(screen.getByLabelText("Assessment"), { target: { value: "Unsaved assessment" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete consultation" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete consultation" }));
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveTextContent("Synthetic note failure"));
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Assessment")).toHaveValue("Unsaved assessment");
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete consultation" }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(3));
  });

  it("serializes an in-flight old autosave before saving the latest reviewed sections", async () => {
    const oldSave = deferred();
    mocks.fetchApi.mockImplementationOnce(() => oldSave.promise).mockResolvedValue({ ok: true });
    render(<ConsultationPage />);
    fireEvent.change(screen.getByLabelText("Assessment"), { target: { value: "Older assessment" } });
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1), { timeout: 2000 });
    fireEvent.change(screen.getByLabelText("Assessment"), { target: { value: "Latest assessment" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete consultation" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete consultation" }));
    expect(mocks.fetchApi).toHaveBeenCalledTimes(1);
    oldSave.resolve();
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(3));
    expect(mocks.fetchApi.mock.calls.map((call) => call[2].method)).toEqual(["PUT", "PUT", "POST"]);
    expect(JSON.parse(mocks.fetchApi.mock.calls[1][2].body)).toEqual({ assessment: "Latest assessment" });
  });

  it("makes finalized sections editable only in amendment mode and submits revised content", async () => {
    mocks.state = { status: "ready", data: { ...context, note_is_final: true } };
    mocks.fetchApi.mockResolvedValue({ ok: true });
    render(<ConsultationPage />);
    expect(screen.queryByRole("textbox", { name: "Assessment" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Amend note" }));
    fireEvent.change(screen.getByLabelText("Assessment"), { target: { value: "Revised assessment" } });
    fireEvent.change(screen.getByLabelText("Reason for amendment *"), { target: { value: "Synthetic correction" } });
    fireEvent.click(screen.getByRole("button", { name: "Save amendment" }));
    await waitFor(() => expect(mocks.fetchApi).toHaveBeenCalledTimes(1));
    expect(JSON.parse(mocks.fetchApi.mock.calls[0][2].body)).toEqual({ reason: "Synthetic correction", assessment: "Revised assessment" });
    expect(mocks.fetchApi.mock.calls[0][1]).toContain("/note/amend");
  });
});
