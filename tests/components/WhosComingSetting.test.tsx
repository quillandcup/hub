// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WhosComingSetting } from "@/app/(member)/settings/WhosComingSetting";
import * as profileActions from "@/app/(member)/settings/profileActions";

vi.mock("@/app/(member)/settings/profileActions", () => ({
  getRosterSetting: vi.fn(),
  setRosterVisibility: vi.fn(),
}));

const checkbox = () => screen.findByRole("checkbox", { name: /Show me in .*Who's coming/ });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WhosComingSetting (Settings > Preferences)", () => {
  it("is on by default and reflects an opt-out, under its own heading", async () => {
    vi.mocked(profileActions.getRosterSetting).mockResolvedValue({ showInRoster: true });
    const { unmount } = render(<WhosComingSetting />);
    expect(await checkbox()).toBeChecked();
    expect(screen.getByRole("heading", { name: "Who's coming" })).toHaveAttribute("id", "profile-whos-coming");
    unmount();

    vi.mocked(profileActions.getRosterSetting).mockResolvedValue({ showInRoster: false });
    render(<WhosComingSetting />);
    expect(await checkbox()).not.toBeChecked();
  });

  it("saves on its own as soon as it is toggled, and says so beside the checkbox", async () => {
    vi.mocked(profileActions.getRosterSetting).mockResolvedValue({ showInRoster: true });
    vi.mocked(profileActions.setRosterVisibility).mockResolvedValue({ success: true });
    render(<WhosComingSetting />);

    await userEvent.click(await checkbox());

    expect(profileActions.setRosterVisibility).toHaveBeenCalledWith(false);
    expect(await checkbox()).not.toBeChecked();
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
  });

  it("puts the box back and says why when saving fails", async () => {
    vi.mocked(profileActions.getRosterSetting).mockResolvedValue({ showInRoster: true });
    vi.mocked(profileActions.setRosterVisibility).mockResolvedValue({ error: "Couldn't save that — please try again." });
    render(<WhosComingSetting />);

    await userEvent.click(await checkbox());

    expect(await screen.findByText("Couldn't save that — please try again.")).toBeInTheDocument();
    expect(await checkbox()).toBeChecked();
  });

  it("shows nothing but the reason when the setting cannot be loaded", async () => {
    vi.mocked(profileActions.getRosterSetting).mockResolvedValue({ error: "Couldn't load this setting" });
    render(<WhosComingSetting />);

    expect(await screen.findByText("Couldn't load this setting")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
