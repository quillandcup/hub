// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const setBigSisterAvailability = vi.fn();
vi.mock("@/app/(member)/big-sisters/actions", () => ({
  setBigSisterAvailability: (...args: unknown[]) => setBigSisterAvailability(...args),
}));

import VolunteerCard from "@/app/(member)/big-sisters/VolunteerCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("VolunteerCard", () => {
  it("volunteers with a note", async () => {
    setBigSisterAvailability.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<VolunteerCard volunteering={false} initialNote="" blockedReason={null} readOnly={false} />);
    await user.type(screen.getByLabelText(/Anything we should know/), "weekday mornings");
    await user.click(screen.getByRole("button", { name: "Add me to the list" }));
    await waitFor(() => expect(setBigSisterAvailability).toHaveBeenCalledWith(true, "weekday mornings"));
  });

  it("lets a volunteer step off the list", async () => {
    setBigSisterAvailability.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    render(<VolunteerCard volunteering initialNote="mornings" blockedReason={null} readOnly={false} />);
    await user.click(screen.getByRole("button", { name: "Step off the list" }));
    await waitFor(() => expect(setBigSisterAvailability).toHaveBeenCalledWith(false, "mornings"));
  });

  it("explains why a newer member can't volunteer yet, with no form", () => {
    render(
      <VolunteerCard
        volunteering={false}
        initialNote=""
        blockedReason="You can volunteer once you've been a member for a full month: from November 1, 2026."
        readOnly={false}
      />
    );
    expect(screen.getByText(/from November 1, 2026/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add me to the list" })).toBeNull();
  });

  it("is read-only in sudo", () => {
    render(<VolunteerCard volunteering={false} initialNote="" blockedReason={null} readOnly />);
    expect(screen.getByRole("button", { name: "Add me to the list" })).toBeDisabled();
  });

  it("shows the error the action returns", async () => {
    setBigSisterAvailability.mockResolvedValue({ error: "Keep the note under 300 characters." });
    const user = userEvent.setup();
    render(<VolunteerCard volunteering={false} initialNote="" blockedReason={null} readOnly={false} />);
    await user.click(screen.getByRole("button", { name: "Add me to the list" }));
    expect(await screen.findByText("Keep the note under 300 characters.")).toBeInTheDocument();
  });
});
