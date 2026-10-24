// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrickleCheckModal from "@/components/writing/PrickleCheckModal";
import { getCheckModalData, saveCheckinHalf, type CheckModalData } from "@/app/(member)/prickles/checkin-actions";
import { logProgress } from "@/app/(member)/projects/actions";
import {
  EMPTY_CHECKIN,
  ENERGY_QUESTION,
  INTENTION_MET_QUESTION,
  PLEASANTNESS_QUESTION,
} from "@/lib/prickle-checkins";

/** A labeled point (or wheel feeling) inside the question group named `question`. */
const option = async (question: string | RegExp, label: string) =>
  within(await screen.findByRole("group", { name: question })).getByRole("button", { name: label });
const WHEEL = /Name the feeling/;

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
    join: null,
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
  it("asks mood, the feeling from the wheel and the intention, and saves just that half", async () => {
    const user = userEvent.setup();
    const { onSaved, onClose } = renderModal("checkin");
    await user.click(await option(PLEASANTNESS_QUESTION, "Bad"));
    await user.click(await option(ENERGY_QUESTION, "Very low"));
    await user.click(await option(WHEEL, "Sad"));
    await user.click(await option(/More specifically, sad/, "Lonely"));
    await user.selectOptions(screen.getByLabelText(/My intention/), "company");
    expect(screen.queryByRole("group", { name: INTENTION_MET_QUESTION })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const answers = { pleasantBefore: 2, energyBefore: 1, emotionBefore: "lonely", need: "company" };
    expect(saveCheckinHalf).toHaveBeenCalledWith("p1", "checkin", answers);
    expect(logProgress).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledWith("p1", expect.objectContaining(answers));
  });

  it("drills into the wheel and back out", async () => {
    const user = userEvent.setup();
    renderModal("checkin");
    await user.click(await option(WHEEL, "Joyful"));
    await user.click(await option(/More specifically, joyful/, "Playful"));
    expect(await option(/More specifically, joyful/, "Playful")).toHaveAttribute("aria-pressed", "true");
    // Picking the specific feeling again goes back to the core; the core again clears it.
    await user.click(await option(/More specifically, joyful/, "Playful"));
    expect(await option(WHEEL, "Joyful")).toHaveAttribute("aria-pressed", "true");
    await user.click(await option(WHEEL, "Joyful"));
    expect(await option(WHEEL, "Joyful")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("group", { name: /More specifically/ })).not.toBeInTheDocument();
  });

  it("shows a join link after saving a check-in when the prickle has one", async () => {
    const user = userEvent.setup();
    vi.mocked(getCheckModalData).mockResolvedValue(data({ join: { url: "https://zoom.us/j/123", meetingId: "880 7170 2629", passcode: "thriving" } }));
    const { onClose } = renderModal("checkin");
    await user.click(await option(PLEASANTNESS_QUESTION, "Good"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    const link = await screen.findByRole("link", { name: "Join the prickle" });
    expect(link).toHaveAttribute("href", "https://zoom.us/j/123");
    expect(screen.getByText("Passcode: thriving")).toBeInTheDocument();
    expect(screen.getByText("Meeting ID: 880 7170 2629")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("starts from the prefill when nothing is saved yet", async () => {
    render(
      <PrickleCheckModal
        prickleId="p1"
        half="checkin"
        onClose={() => {}}
        onSaved={() => {}}
        prefill={{ ...EMPTY_CHECKIN, pleasantBefore: 2, emotionBefore: "anxious", need: "company" }}
      />
    );
    expect(await option(PLEASANTNESS_QUESTION, "Bad")).toHaveAttribute("aria-pressed", "true");
    expect(await option(/More specifically, scared/, "Anxious")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/My intention/)).toHaveValue("company");
  });
});

describe("PrickleCheckModal check-out", () => {
  it("asks got-what-you-came-for, mood and the feeling, and a numeric question per project, worded for its measure", async () => {
    renderModal("checkout");
    const met = within(await screen.findByRole("group", { name: INTENTION_MET_QUESTION }));
    expect(met.getAllByRole("button").map((b) => b.textContent)).toEqual(["Not at all", "A little", "Somewhat", "Mostly", "Completely"]);
    expect(screen.getByRole("group", { name: PLEASANTNESS_QUESTION })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: ENERGY_QUESTION })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: WHEEL })).toBeInTheDocument();
    expect(screen.queryByLabelText(/My intention/)).not.toBeInTheDocument();
    const words = screen.getByLabelText(NOVEL_QUESTION);
    expect(words).toHaveAttribute("type", "number");
    expect(screen.getByLabelText(/How many scenes did you write on Memoir/)).toBeInTheDocument();
  });

  it("saves the check-out answers, then logs only the amounts that were filled in", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal("checkout");
    await user.click(await option(INTENTION_MET_QUESTION, "Mostly"));
    await user.click(await option(PLEASANTNESS_QUESTION, "Good"));
    await user.click(await option(ENERGY_QUESTION, "Medium"));
    await user.type(screen.getByLabelText(NOVEL_QUESTION), "450");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(saveCheckinHalf).toHaveBeenCalledWith("p1", "checkout", {
      intentionMet: 4,
      pleasantAfter: 4,
      energyAfter: 3,
      emotionAfter: null,
    });
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

  it("logs a fractional amount (a quarter of a chapter)", async () => {
    const user = userEvent.setup();
    const { onClose } = renderModal("checkout");
    await user.type(await screen.findByLabelText(NOVEL_QUESTION), "0.25");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(logProgress).toHaveBeenCalledWith(expect.objectContaining({ projectId: "proj-1", amount: 0.25 }));
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
    await screen.findByRole("group", { name: INTENTION_MET_QUESTION });
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
