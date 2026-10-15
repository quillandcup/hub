// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
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

describe("ChatText", () => {
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
});
