// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LogProgressModal from "@/components/writing/LogProgressModal";
import { getPricklesOnDate, logProgress, updateEntry, type EntryRow } from "@/app/(member)/projects/actions";

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
