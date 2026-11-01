// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogProgressModal from "@/components/writing/LogProgressModal";
import { getPricklesOnDate, logProgress, updateEntry, type EntryRow } from "@/app/(member)/projects/actions";
import { getCheckinForLogging, saveCheckin } from "@/app/(member)/prickles/checkin-actions";
import { EMPTY_CHECKIN, ENERGY_QUESTION, INTENTION_MET_QUESTION, PLEASANTNESS_QUESTION } from "@/lib/prickle-checkins";

const option = async (question: string, label: string) =>
  within(await screen.findByRole("group", { name: question })).getByRole("button", { name: label });

vi.mock("@/app/(member)/prickles/checkin-actions", () => ({
  getCheckinForLogging: vi.fn(),
  saveCheckin: vi.fn(),
}));

vi.mock("@/app/(member)/projects/actions", () => ({
  getPricklesOnDate: vi.fn(),
  logProgress: vi.fn(),
  updateEntry: vi.fn(),
}));

const PROJECTS = [{ id: "project-1", title: "My Novel" }];

const ATTENDED = {
  id: "prickle-attended",
  label: "Thu, Oct 1 · 9:00 AM · Morning Sprint with Jo",
  startTime: "2026-10-01T13:00:00Z",
  attended: true,
};
const OTHER = {
  id: "prickle-other",
  label: "Thu, Oct 1 · 7:00 PM · Night Owls",
  startTime: "2026-10-01T23:00:00Z",
  attended: false,
};

function prickleSelect() {
  return screen.getByLabelText("During which prickle?") as HTMLSelectElement;
}

async function fillAmountAndSubmit(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.type(screen.getByPlaceholderText("e.g. 500"), "750");
  await user.click(screen.getByRole("button", { name: label }));
}

beforeEach(() => {
  vi.mocked(getPricklesOnDate).mockReset().mockResolvedValue([ATTENDED, OTHER]);
  vi.mocked(logProgress).mockReset().mockResolvedValue({ success: true, id: "entry-1" });
  vi.mocked(updateEntry).mockReset().mockResolvedValue({ success: true });
  vi.mocked(getCheckinForLogging).mockReset().mockResolvedValue({ checkin: null, canEdit: true });
  vi.mocked(saveCheckin).mockReset().mockResolvedValue({ success: true });
});

describe("LogProgressModal prickle picker", () => {
  it("lists the date's prickles and defaults a new entry to the one the member attended", async () => {
    render(
      <LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} defaultEntryDate="2026-10-01" />
    );

    await waitFor(() => expect(prickleSelect().value).toBe("prickle-attended"));
    expect(getPricklesOnDate).toHaveBeenCalledWith("2026-10-01");
    expect(screen.getByRole("option", { name: `${ATTENDED.label} (you attended)` })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: OTHER.label })).toBeInTheDocument();

    const user = userEvent.setup();
    await fillAmountAndSubmit(user, "Log progress");
    expect(logProgress).toHaveBeenCalledWith(expect.objectContaining({ prickleId: "prickle-attended", amount: 750 }));
  });

  it("logs a fractional amount (a quarter of a chapter)", async () => {
    render(
      <LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} defaultEntryDate="2026-10-01" />
    );
    await waitFor(() => expect(prickleSelect().value).toBe("prickle-attended"));

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText("e.g. 500"), "0.25");
    await user.click(screen.getByRole("button", { name: "Log progress" }));
    await waitFor(() => expect(logProgress).toHaveBeenCalledWith(expect.objectContaining({ amount: 0.25 })));
  });

  it("doesn't link a prickle when the member attended none that day", async () => {
    vi.mocked(getPricklesOnDate).mockResolvedValue([OTHER]);
    render(
      <LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} defaultEntryDate="2026-10-01" />
    );
    await screen.findByRole("option", { name: OTHER.label });
    expect(prickleSelect().value).toBe("");

    const user = userEvent.setup();
    await fillAmountAndSubmit(user, "Log progress");
    expect(vi.mocked(logProgress).mock.calls[0][0]).not.toHaveProperty("prickleId");
  });

  it("keeps the prickle it was opened from rather than the default", async () => {
    render(
      <LogProgressModal
        isOpen
        onClose={() => {}}
        onSaved={() => {}}
        projects={PROJECTS}
        prickleId="prickle-other"
        defaultEntryDate="2026-10-01"
      />
    );
    await screen.findByRole("option", { name: OTHER.label });
    expect(prickleSelect().value).toBe("prickle-other");
  });

  it("lets an edit attach and detach a prickle", async () => {
    const entry: EntryRow = {
      id: "entry-1",
      projectId: "project-1",
      entryDate: "2026-10-01",
      measure: "words",
      mode: "delta",
      amount: 500,
      note: null,
      tags: [],
      createdAt: "2026-10-01T14:00:00Z",
      prickleId: null,
      prickleLabel: null,
    };
    render(<LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} editingEntry={entry} />);
    await screen.findByRole("option", { name: OTHER.label });
    // An existing unlinked entry stays unlinked until the member picks one.
    expect(prickleSelect().value).toBe("");

    const user = userEvent.setup();
    await user.selectOptions(prickleSelect(), "prickle-other");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateEntry).toHaveBeenCalledWith("entry-1", expect.objectContaining({ prickleId: "prickle-other" }));

    await user.selectOptions(prickleSelect(), "");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateEntry).toHaveBeenLastCalledWith("entry-1", expect.objectContaining({ prickleId: null }));
  });

  it("keeps showing a linked prickle from another date when editing", async () => {
    vi.mocked(getPricklesOnDate).mockResolvedValue([]);
    const entry: EntryRow = {
      id: "entry-2",
      projectId: "project-1",
      entryDate: "2026-10-02",
      measure: "words",
      mode: "delta",
      amount: 200,
      note: null,
      tags: [],
      createdAt: "2026-10-02T14:00:00Z",
      prickleId: "prickle-attended",
      prickleLabel: ATTENDED.label,
    };
    render(<LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} editingEntry={entry} />);
    await waitFor(() => expect(getPricklesOnDate).toHaveBeenCalled());
    expect(prickleSelect().value).toBe("prickle-attended");
    expect(screen.getByRole("option", { name: ATTENDED.label })).toBeInTheDocument();
  });
});

describe("LogProgressModal check-out", () => {
  function renderForPrickle(prickleId = "prickle-other") {
    return render(
      <LogProgressModal
        isOpen
        onClose={() => {}}
        onSaved={() => {}}
        projects={PROJECTS}
        prickleId={prickleId}
        defaultEntryDate="2026-10-01"
      />
    );
  }

  it("asks only the check-out questions, linking to the check-in modal for the check-in", async () => {
    renderForPrickle();
    expect(await screen.findByRole("heading", { name: /Check out/ })).toBeInTheDocument();
    expect(getCheckinForLogging).toHaveBeenCalledWith("prickle-other");
    expect(screen.getByRole("group", { name: INTENTION_MET_QUESTION })).toBeInTheDocument();
    expect(screen.getByText("How are you feeling now?")).toBeInTheDocument();
    expect(screen.queryByLabelText(/My intention/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Coming in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/What I need/)).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Edit check-in/ });
    expect(link).toHaveAttribute("href", "/my-prickles/history?checkin=prickle-other");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("saves the check-out before the entry, keeping the latest check-in answers", async () => {
    vi.mocked(getCheckinForLogging).mockResolvedValue({
      checkin: { ...EMPTY_CHECKIN, pleasantBefore: 2, energyBefore: 2, need: "company" },
      canEdit: true,
    });
    const user = userEvent.setup();
    renderForPrickle();
    await user.click(await option(INTENTION_MET_QUESTION, "Mostly"));
    await user.click(await option(PLEASANTNESS_QUESTION, "Good"));

    // The check-in was edited in another tab while the modal was open.
    vi.mocked(getCheckinForLogging).mockResolvedValue({
      checkin: { ...EMPTY_CHECKIN, pleasantBefore: 1, energyBefore: 2, need: "momentum" },
      canEdit: true,
    });
    await fillAmountAndSubmit(user, "Log progress");

    expect(saveCheckin).toHaveBeenCalledWith("prickle-other", {
      ...EMPTY_CHECKIN,
      pleasantBefore: 1,
      energyBefore: 2,
      need: "momentum",
      intentionMet: 4,
      pleasantAfter: 4,
    });
    expect(vi.mocked(saveCheckin).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(logProgress).mock.invocationCallOrder[0]
    );
  });

  it("starts from the saved check-out", async () => {
    vi.mocked(getCheckinForLogging).mockResolvedValue({
      checkin: { ...EMPTY_CHECKIN, intentionMet: 2, energyAfter: 1 },
      canEdit: true,
    });
    renderForPrickle();
    expect(await option(INTENTION_MET_QUESTION, "A little")).toHaveAttribute("aria-pressed", "true");
    expect(await option(ENERGY_QUESTION, "Very low")).toHaveAttribute("aria-pressed", "true");
  });

  it("doesn't touch the check-in when the check-out wasn't changed", async () => {
    const user = userEvent.setup();
    renderForPrickle();
    await screen.findByRole("group", { name: INTENTION_MET_QUESTION });
    await fillAmountAndSubmit(user, "Log progress");
    expect(saveCheckin).not.toHaveBeenCalled();
    expect(logProgress).toHaveBeenCalled();
  });

  it("stops before saving the entry when the check-out fails", async () => {
    vi.mocked(saveCheckin).mockResolvedValue({ error: "Couldn't save your check-in — please try again." });
    const user = userEvent.setup();
    renderForPrickle();
    await user.click(await option(INTENTION_MET_QUESTION, "Somewhat"));
    await fillAmountAndSubmit(user, "Log progress");

    expect(await screen.findByText("Couldn't save your check-in — please try again.")).toBeInTheDocument();
    expect(logProgress).not.toHaveBeenCalled();
  });

  it("has no check-out without a prickle, or in sudo", async () => {
    vi.mocked(getPricklesOnDate).mockResolvedValue([OTHER]);
    const { unmount } = render(
      <LogProgressModal isOpen onClose={() => {}} onSaved={() => {}} projects={PROJECTS} defaultEntryDate="2026-10-01" />
    );
    await screen.findByRole("option", { name: OTHER.label });
    expect(screen.queryByRole("group", { name: INTENTION_MET_QUESTION })).not.toBeInTheDocument();
    unmount();

    vi.mocked(getCheckinForLogging).mockResolvedValue({ checkin: null, canEdit: false });
    renderForPrickle();
    await waitFor(() => expect(getCheckinForLogging).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: INTENTION_MET_QUESTION })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Edit check-in/ })).not.toBeInTheDocument();
  });
});
