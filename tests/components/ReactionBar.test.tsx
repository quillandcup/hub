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
    render(<ReactionBar channelId="c1" messageId="m1" reactions={REACTIONS} custom={{}} canReact={false} />);
    expect(screen.getByRole("list", { name: "Reactions" })).toHaveTextContent("2");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders nothing for a message with no reactions the viewer can't add to", () => {
    const { container } = render(<ReactionBar channelId="c1" messageId="m1" reactions={[]} custom={{}} canReact={false} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("toggles a chip: pressing your own takes it back, pressing another adds yours", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: true, active: false });
    render(<ReactionBar channelId="c1" messageId="m1" reactions={REACTIONS} custom={{}} canReact />);

    expect(screen.getByRole("button", { name: /Remove your :tada: reaction/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Add :eyes: reaction/ })).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(screen.getByRole("button", { name: /Remove your :tada: reaction/ }));
    await waitFor(() => expect(toggleChatReaction).toHaveBeenCalledWith("m1", "tada"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("has no add-reaction button of its own, even with no reactions or for a viewer who can react", () => {
    const { container } = render(<ReactionBar channelId="c1" messageId="m1" reactions={[]} custom={{}} canReact />);
    expect(container).toBeEmptyDOMElement();
    cleanup();
    render(<ReactionBar channelId="c1" messageId="m1" reactions={REACTIONS} custom={{}} canReact />);
    expect(screen.queryByRole("button", { name: "Add reaction" })).not.toBeInTheDocument();
  });

  it("shows why a reaction was refused and doesn't refresh", async () => {
    vi.mocked(toggleChatReaction).mockResolvedValue({ ok: false, error: "This conversation is archived." });
    render(<ReactionBar channelId="c1" messageId="m1" reactions={REACTIONS} custom={{}} canReact />);
    await userEvent.click(screen.getByRole("button", { name: /Add :eyes: reaction/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("This conversation is archived.");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("ReactionBar hover card", () => {
  it("names who reacted, with the viewer first and the shortcode, and drops the browser title", () => {
    render(
      <ReactionBar
        channelId="c1"
        messageId="m1"
        reactions={[
          { emoji: "tada", count: 2, mine: true, reactors: ["Bo & <Co>"] },
          { emoji: "eyes", count: 2, mine: false, reactors: ["Ada", "Bo"] },
        ]}
        custom={{}}
        canReact={false}
      />
    );
    expect(screen.getByText("You (click to remove) and Bo & <Co> reacted with :tada:")).toBeInTheDocument();
    expect(screen.getByText("Ada and Bo reacted with :eyes:")).toBeInTheDocument();
  });
});

describe("reactorsSentence", () => {
  it("names who reacted, counting people without names and the viewer", async () => {
    const { reactorsSentence } = await import("@/components/chat/ReactionBar");
    expect(reactorsSentence({ emoji: "tada", count: 1, mine: true })).toBe("You (click to remove) reacted with :tada:");
    expect(reactorsSentence({ emoji: "tada", count: 3, mine: true, reactors: ["Bo & <Co>"] })).toBe("You (click to remove), Bo & <Co> and 1 more reacted with :tada:");
    expect(reactorsSentence({ emoji: "eyes", count: 2, mine: false })).toBe("2 people reacted with :eyes:");
    expect(reactorsSentence({ emoji: "eyes", count: 0, mine: false })).toBe(" reacted with :eyes:");
  });
});
