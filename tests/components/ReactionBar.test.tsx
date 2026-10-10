// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/(member)/chat/actions", () => ({ toggleChatReaction: vi.fn() }));
import { toggleChatReaction } from "@/app/(member)/chat/actions";
import ReactionBar from "@/components/chat/ReactionBar";

const REACTIONS = [
  { emoji: "tada", count: 2, mine: true },
  { emoji: "eyes", count: 1, mine: false },
];

beforeEach(() => {
  cleanup();
  refresh.mockReset();
  vi.mocked(toggleChatReaction).mockReset();
});

describe("ReactionBar", () => {
  it("shows the chips and nothing to press when the viewer can't react", () => {
    render(<ReactionBar messageId="m1" reactions={REACTIONS} custom={{}} canReact={false} />);
    expect(screen.getByRole("list", { name: "Reactions" })).toHaveTextContent("2");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for a message with no reactions the viewer can't add to", () => {
    const { container } = render(<ReactionBar messageId="m1" reactions={[]} custom={{}} canReact={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles a chip: pressing your own takes it back, pressing another adds yours", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: true, active: false });
    render(<ReactionBar messageId="m1" reactions={REACTIONS} custom={{}} canReact />);

    expect(screen.getByRole("button", { name: /Remove your :tada: reaction/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Add :eyes: reaction/ })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: /Remove your :tada: reaction/ }));
    await waitFor(() => expect(toggleChatReaction).toHaveBeenCalledWith("m1", "tada"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("adds a reaction from the picker, which closes after a choice", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: true, active: true });
    render(<ReactionBar messageId="m1" reactions={[]} custom={{}} canReact />);

    expect(screen.queryByRole("list", { name: "Pick a reaction" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(screen.getByRole("button", { name: "React with :heart:" }));

    await waitFor(() => expect(toggleChatReaction).toHaveBeenCalledWith("m1", "heart"));
    expect(screen.queryByRole("list", { name: "Pick a reaction" })).not.toBeInTheDocument();
  });

  it("shows why a reaction was refused and doesn't refresh", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: false, error: "This conversation is archived." });
    render(<ReactionBar messageId="m1" reactions={REACTIONS} custom={{}} canReact />);
    await userEvent.click(screen.getByRole("button", { name: /Add :eyes: reaction/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This conversation is archived.");
    expect(refresh).not.toHaveBeenCalled();
  });
});
