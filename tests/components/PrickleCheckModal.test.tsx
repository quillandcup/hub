// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrickleCheckModal from "@/components/writing/PrickleCheckModal";
import { getCheckModalData, saveCheckinHalf, type CheckModalData } from "@/app/(member)/prickles/checkin-actions";
import { logProgress } from "@/app/(member)/projects/actions";

vi.mock("@/app/(member)/prickles/checkin-actions", () => ({
  getCheckModalData: vi.fn(),
  saveCheckinHalf: vi.fn(),
}));
vi.mock("@/app/(member)/projects/actions", () => ({ logProgress: vi.fn() }));

const TITLE = "Monday Progress Prickle with Jenn P";
const NOVEL_QUESTION = `How many words did you write on The Hedgehog's Journey during ${TITLE}?`;

function data(overrides: Partial<CheckModalData> = {}): CheckModalData {
  return {
    prickleTitle: TITLE,
    entryDate: "2026-10-05",
    hasStarted: true,
    checkin: null,
    canEdit: true,
    projects: [
      { id: "proj-1", title: "The Hedgehog's Journey", measure: "words", question: NOVEL_QUESTION, logged: [] },
      {
        id: "proj-2",
        title: "Memoir",
        measure: "scenes",
        question: `How many scenes did you write on Memoir during ${TITLE}?`,
        logged: [],
      },
    ],
    ...overrides,
  };
}

function renderModal(half: "checkin" | "checkout", onSaved = vi.fn(), onClose = vi.fn()) {
  render(<PrickleCheckModal prickleId="p1" half={half} onClose={onClose} onSaved={onSaved} />);
  return { onSaved, onClose };
}

beforeEach(() => {
  vi.mocked(getCheckModalData).mockReset().mockResolvedValue(data());
  vi.mocked(saveCheckinHalf).mockReset().mockResolvedValue({ success: true });
  vi.mocked(logProgress).mockReset().mockResolvedValue({ success: true, id: "e1" });
});

describe("PrickleCheckModal check-in", () => {
  it("asks how they were feeling coming in and what they needed, and saves just that half", async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderModal("checkin");
    await user.click(await screen.findByRole("button", { name: "Calm" }));
    await user.click(screen.getByRole("button", { name: /Momentum/ }));
    expect(screen.queryByText("How did it go?")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCheckinHalf).toHaveBeenCalledWith("p1", "checkin", { feelingsBefore: ["calm"], need: "momentum" });
    expect(logProgress).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("p1", expect.objectContaining({ feelingsBefore: ["calm"], need: "momentum" }));
  });

  it("starts from the prefill when nothing is saved yet", async () => {
    render(
      <PrickleCheckModal
        prickleId="p1"
        half="checkin"
        onClose={() => {}}
        onSaved={() => {}}
        prefill={{ feelingsBefore: ["stressed"], need: "company", sessionRating: null, feelingsAfter: [] }}
      />
    );
    expect(await screen.findByRole("button", { name: "Stressed" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("PrickleCheckModal check-out", () => {
  it("shows five stars side by side and a numeric question per project, worded for its measure", async () => {
    renderModal("checkout");
    expect(await screen.findByText("How did it go?")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\d of 5/ })).toHaveLength(5);
    const words = screen.getByLabelText(NOVEL_QUESTION);
    expect(words).toHaveAttribute("type", "number");
    expect(screen.getByLabelText(/How many scenes did you write on Memoir/)).toBeInTheDocument();
  });

  it("saves the check-out answers, then logs only the amounts that were filled in", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal("checkout");
    await user.click(await screen.findByRole("button", { name: /4 of 5/ }));
    await user.click(screen.getByRole("button", { name: "Drained" }));
    await user.type(screen.getByLabelText(NOVEL_QUESTION), "450");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCheckinHalf).toHaveBeenCalledWith("p1", "checkout", { sessionRating: 4, feelingsAfter: ["drained"] });
    expect(logProgress).toHaveBeenCalledTimes(1);
    expect(logProgress).toHaveBeenCalledWith({
      projectId: "proj-1",
      entryDate: "2026-10-05",
      measure: "words",
      mode: "delta",
      amount: 450,
      prickleId: "p1",
    });
    expect(vi.mocked(saveCheckinHalf).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(logProgress).mock.invocationCallOrder[0]
    );
  });

  it("doesn't ask again about a project already logged for this prickle", async () => {
    vi.mocked(getCheckModalData).mockResolvedValue(
      data({
        projects: [
          { ...data().projects[0], logged: [{ amount: 500, measure: "words", mode: "delta" }] },
          data().projects[1],
        ],
      })
    );
    renderModal("checkout");
    await screen.findByText("How did it go?");
    expect(screen.queryByLabelText(NOVEL_QUESTION)).not.toBeInTheDocument();
    expect(screen.getByText(/\+500 words/)).toBeInTheDocument();
  });

  it("won't save a negative amount (the browser blocks the submit)", async () => {
    const user = userEvent.setup();
    renderModal("checkout");
    await user.type(await screen.findByLabelText(NOVEL_QUESTION), "-3");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(saveCheckinHalf).not.toHaveBeenCalled();
    expect(logProgress).not.toHaveBeenCalled();
  });

  it("stops before logging when the check-out fails to save", async () => {
    vi.mocked(saveCheckinHalf).mockResolvedValue({ error: "nope" });
    const user = userEvent.setup();
    renderModal("checkout");
    await user.type(await screen.findByLabelText(NOVEL_QUESTION), "100");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();
    expect(logProgress).not.toHaveBeenCalled();
  });

  it("isn't available before the prickle starts", async () => {
    vi.mocked(getCheckModalData).mockResolvedValue(data({ hasStarted: false }));
    renderModal("checkout");
    expect(await screen.findByText("Available once the prickle starts.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
  });

  it("is read-only in sudo", async () => {
    vi.mocked(getCheckModalData).mockResolvedValue(data({ canEdit: false }));
    renderModal("checkout");
    expect(await screen.findByText(/Read-only/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(NOVEL_QUESTION)).toBeDisabled();
  });
});
