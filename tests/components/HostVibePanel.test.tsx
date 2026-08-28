// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HostVibePanel from "@/components/HostVibePanel";
import { saveHostVibe } from "@/app/(member)/prickle-picker/actions";

vi.mock("@/app/(member)/prickle-picker/actions", () => ({
  saveHostVibe: vi.fn(),
}));

const hostedVibes = [
  { typeId: "type-a", typeName: "Heads Down", vibe: "focused" as const, notes: "" },
  { typeId: "type-b", typeName: "Midnight Crew", vibe: "chatty" as const, notes: "goofy crew" },
];

beforeEach(() => {
  vi.mocked(saveHostVibe).mockReset();
});

describe("HostVibePanel", () => {
  it("renders nothing when the member hosts no prickle types", () => {
    const { container } = render(<HostVibePanel hostedVibes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("lists each hosted type with its current vibe and notes", () => {
    render(<HostVibePanel hostedVibes={hostedVibes} />);
    expect(screen.getByText("Heads Down")).toBeInTheDocument();
    expect(screen.getByText("Midnight Crew")).toBeInTheDocument();
    expect(screen.getByDisplayValue("goofy crew")).toBeInTheDocument();
  });

  it("disables Save until a change is made, then saves the new vibe", async () => {
    vi.mocked(saveHostVibe).mockResolvedValue({ success: true });

    render(<HostVibePanel hostedVibes={hostedVibes} />);

    const saveButtons = screen.getAllByRole("button", { name: "Save" });
    expect(saveButtons[0]).toBeDisabled();

    await userEvent.click(screen.getAllByRole("button", { name: "💬 Chatty" })[0]);
    expect(saveButtons[0]).toBeEnabled();

    await userEvent.click(saveButtons[0]);

    expect(saveHostVibe).toHaveBeenCalledWith("type-a", "chatty", "");
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("shows an error and keeps Save enabled when the save fails", async () => {
    vi.mocked(saveHostVibe).mockResolvedValue({ error: "You can only tag prickle types you host" });

    render(<HostVibePanel hostedVibes={hostedVibes} />);

    await userEvent.click(screen.getAllByRole("button", { name: "🎯 Balanced" })[0]);
    await userEvent.click(screen.getAllByRole("button", { name: "Save" })[0]);

    expect(await screen.findByText("You can only tag prickle types you host")).toBeInTheDocument();
  });
});
