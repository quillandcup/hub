// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const getMemberHoverCard = vi.fn();
vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: (...a: unknown[]) => getMemberHoverCard(...a) }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
import ChatText from "@/components/chat/ChatText";

const ctx = {
  userNames: { U_JUDE: "Jude Cocaigne", U_NOBODY: "Pat" } as Record<string, string>,
  userMembers: { U_JUDE: "member-jude" } as Record<string, string>,
  channelIds: { C_FAIR: "hub-fair" } as Record<string, string>,
  channelNames: { C_FAIR: "book-fair", C_OTHER: "elsewhere" } as Record<string, string>,
  customEmoji: {
    hedgehog: { url: "https://emoji.example.test/hedgehog.png" },
    hog: { text: "🦔" },
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ChatText", () => {
  it("draws a message of only emoji large, but not one with text or a shortcode it can't draw", () => {
    const wrapper = (body: string) => {
      const { container } = render(<ChatText body={body} ctx={ctx} />);
      const el = container.firstElementChild as HTMLElement;
      cleanup();
      return el;
    };
    expect(wrapper("\u{1F64F}")).toHaveClass("text-[2rem]");
    expect(wrapper(":hedgehog: :hog:")).toHaveClass("text-[2rem]");
    expect(wrapper("\u{1F64F} do it")).not.toHaveClass("text-[2rem]");
    expect(wrapper(":nosuchemoji:")).not.toHaveClass("text-[2rem]");
  });

  it("draws <u>…</u> as underlined text, around other formatting", () => {
    const { container } = render(<ChatText body="a <u>under *bold*</u> b" ctx={ctx} />);
    const u = container.querySelector("u")!;
    expect(u).toHaveTextContent("under bold");
    expect(u.querySelector("strong")).toHaveTextContent("bold");
  });

  it("shows custom emoji as images, over a standard emoji of the same name", () => {
    render(<ChatText body=":hedgehog: hi" ctx={ctx} />);
    expect(screen.getByAltText(":hedgehog:")).toHaveAttribute("src", "https://emoji.example.test/hedgehog.png");
  });

  it("shows standard emoji, aliases of them, and leaves unknown shortcodes as typed", () => {
    render(<ChatText body=":books: :hog: :nope-nope:" ctx={ctx} />);
    expect(screen.getByText(/📚/)).toBeInTheDocument();
    expect(screen.getByText("🦔")).toBeInTheDocument();
    expect(screen.getByText(":nope-nope:")).toBeInTheDocument();
  });

  it("shows inline code in red monospace like Slack, and a code block without the red", () => {
    render(<ChatText body={"say `get it` now\n```\nblock\n```"} ctx={ctx} />);
    expect(screen.getByText("get it")).toHaveClass("font-mono", "text-red-700");
    expect(screen.getByText("block")).not.toHaveClass("text-red-700");
  });

  it("renders bullet lines as one list and a blank line as a paragraph gap", () => {
    render(<ChatText body={"Intro\n\nA list:\n• one\n• *two*"} ctx={ctx} />);
    expect(screen.getAllByRole("list")).toHaveLength(1);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["•one", "•two"]);
    expect(screen.getByText("A list:")).toHaveClass("mt-3");
    expect(screen.getByText("Intro")).not.toHaveClass("mt-3");
  });

  it("names a channel link from the channel, not the text's own label, and links the ones we mirror", () => {
    render(<ChatText body="Hang out in <#C_FAIR|channel> or <#C_OTHER> or <#C_UNKNOWN>" ctx={ctx} />);
    expect(screen.getByRole("link", { name: "#book-fair" })).toHaveAttribute("href", "/chat/hub-fair");
    expect(screen.getByText("#elsewhere").tagName).toBe("SPAN");
    expect(screen.getByText("#channel")).toBeInTheDocument();
  });

  it("links a mention of a matched person to their profile, and not other mentions", () => {
    render(<ChatText body="<@U_JUDE> and <@U_NOBODY>" ctx={ctx} />);
    expect(screen.getByRole("link", { name: "@Jude Cocaigne" })).toHaveAttribute("href", "/members/member-jude");
    expect(screen.getByText("@Pat").tagName).toBe("SPAN");
  });

  it("underlines links so they stand out", () => {
    render(<ChatText body="<https://example.test|the form>" ctx={ctx} />);
    expect(screen.getByRole("link", { name: "the form" })).toHaveClass("underline");
  });

  it("opens the member's hover card when a matched mention is hovered, and not for other mentions", async () => {
    vi.useFakeTimers();
    getMemberHoverCard.mockResolvedValue({
      card: { id: "member-jude", name: "Jude Example", photoUrl: null, firstJoinedAt: "2025-03-10", askMeAbout: [], instagramUrl: null, facebookUrl: null, twitterUrl: null, messageUrl: null },
    });
    render(<ChatText body="<@U_JUDE> and <@U_NOBODY>" ctx={ctx} />);

    fireEvent.pointerEnter(screen.getByText("@Pat"), { pointerType: "mouse" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerEnter(screen.getByText("@Jude Cocaigne"), { pointerType: "mouse" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(getMemberHoverCard).toHaveBeenCalledWith("member-jude");
    expect(screen.getByRole("dialog")).toHaveTextContent("Hedgie since March 2025");
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/members/member-jude");
  });
});
