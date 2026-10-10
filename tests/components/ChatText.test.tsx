// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ChatText from "@/components/chat/ChatText";

const ctx = {
  userNames: {},
  channelIds: {},
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
});
