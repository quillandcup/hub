// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PrickleCheckIn from "@/components/writing/PrickleCheckIn";
import { saveCheckin } from "@/app/(member)/prickles/checkin-actions";

vi.mock("@/app/(member)/prickles/checkin-actions", () => ({
  saveCheckin: vi.fn(),
}));

function chip(name: string | RegExp, index = 0) {
  return screen.getAllByRole("button", { name })[index];
}

beforeEach(() => {
  vi.mocked(saveCheckin).mockReset().mockResolvedValue({ success: true });
});

describe("PrickleCheckIn", () => {
  it("only asks the coming-in questions before the prickle starts", () => {
    render(<PrickleCheckIn prickleId="prickle-1" hasStarted={false} initial={null} />);
    expect(screen.getByText(/Coming in, I'm feeling/)).toBeInTheDocument();
    expect(screen.getByText("What I need from this session")).toBeInTheDocument();
    expect(screen.queryByText("How did it go?")).not.toBeInTheDocument();
    expect(screen.queryByText(/Feeling now/)).not.toBeInTheDocument();
  });

  it("saves feelings, need, rating and feelings after", async () => {
    const user = userEvent.setup();
    render(<PrickleCheckIn prickleId="prickle-1" hasStarted initial={null} />);

    // Each feeling appears twice once the session has started: before (index 0) and after (1).
    await user.click(chip("Stressed", 0));
    await user.click(chip("Tired", 0));
    await user.click(chip(/^Gentle/));
    await user.click(chip("Good"));
    await user.click(chip("Calm", 1));
    await user.click(screen.getByRole("button", { name: "Save check-in" }));

    expect(saveCheckin).toHaveBeenCalledWith("prickle-1", {
      feelingsBefore: ["stressed", "tired"],
      need: "gentle",
      sessionRating: 4,
      feelingsAfter: ["calm"],
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("caps feelings at two by disabling the rest", async () => {
    const user = userEvent.setup();
    render(<PrickleCheckIn prickleId="prickle-1" hasStarted={false} initial={null} />);
    await user.click(chip("Stressed"));
    await user.click(chip("Tired"));
    expect(chip("Calm")).toBeDisabled();
    expect(chip("Stressed")).toHaveAttribute("aria-pressed", "true");

    await user.click(chip("Stressed"));
    expect(chip("Calm")).toBeEnabled();
  });

  it("starts from the saved check-in and offers to clear it", async () => {
    const user = userEvent.setup();
    render(
      <PrickleCheckIn
        prickleId="prickle-1"
        hasStarted={false}
        initial={{ feelingsBefore: ["lonely"], need: null, sessionRating: null, feelingsAfter: [] }}
      />
    );
    expect(chip("Lonely")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Save check-in" })).toBeDisabled();

    await user.click(chip("Lonely"));
    await user.click(screen.getByRole("button", { name: "Clear check-in" }));
    expect(saveCheckin).toHaveBeenCalledWith("prickle-1", {
      feelingsBefore: [],
      need: null,
      sessionRating: null,
      feelingsAfter: [],
    });
  });

  it("is read-only in sudo: answers shown, nothing editable or saveable", () => {
    render(
      <PrickleCheckIn
        prickleId="prickle-1"
        hasStarted
        readOnly
        initial={{ feelingsBefore: ["drained"], need: "gentle", sessionRating: 2, feelingsAfter: [] }}
      />
    );
    expect(screen.getByText("Read-only while browsing as this member.")).toBeInTheDocument();
    expect(chip("Drained", 0)).toHaveAttribute("aria-pressed", "true");
    expect(chip("Drained", 0)).toBeDisabled();
    expect(chip(/^Gentle/)).toBeDisabled();
    expect(chip("Meh")).toBeDisabled();
    expect(chip("Calm", 1)).toBeDisabled();
    expect(screen.queryByRole("button", { name: /check-in/ })).not.toBeInTheDocument();
  });

  it("shows a save error", async () => {
    vi.mocked(saveCheckin).mockResolvedValue({ error: "Couldn't save your check-in — please try again." });
    const user = userEvent.setup();
    render(<PrickleCheckIn prickleId="prickle-1" hasStarted={false} initial={null} />);
    await user.click(chip("Curious"));
    await user.click(screen.getByRole("button", { name: "Save check-in" }));
    expect(await screen.findByText("Couldn't save your check-in — please try again.")).toBeInTheDocument();
  });
});
