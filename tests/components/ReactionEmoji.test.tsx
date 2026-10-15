// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import ReactionEmoji from "@/components/ReactionEmoji";
import MemberSlackActivityPanel from "@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel";

describe("ReactionEmoji", () => {
  it("shows a custom emoji as its image, a standard one as text, and an unknown one as :name:", () => {
    const { rerender } = render(<ReactionEmoji name="yes-party" emoji={{ url: "https://emoji.example.test/p.gif" }} />);
    expect(screen.getByRole("img", { name: ":yes-party:" })).toHaveAttribute("src", "https://emoji.example.test/p.gif");
    rerender(<ReactionEmoji name="tada" emoji={{ text: "🎉" }} />);
    expect(screen.getByText("🎉")).toBeInTheDocument();
    rerender(<ReactionEmoji name="mystery" />);
    expect(screen.getByText(":mystery:")).toBeInTheDocument();
  });
});

describe("member Slack tab reactions", () => {
  const reaction = (id: string, name: string, emoji?: object) => ({
    id,
    activity_type: "slack_reaction",
    occurred_at: "2026-09-01T10:00:00Z",
    description: null,
    title: `Reacted :${name}:`,
    data: { reaction: name, channel_name: "writing", ...(emoji ? { reaction_emoji: emoji } : {}) },
  });

  it("renders the resolved emoji instead of the literal shortcode", () => {
    render(
      <MemberSlackActivityPanel
        slackActivities={[
          reaction("1", "yes-party", { url: "https://emoji.example.test/p.gif" }),
          reaction("2", "rocket", { text: "🚀" }),
        ]}
      />
    );
    expect(screen.getAllByRole("img", { name: ":yes-party:" }).length).toBeGreaterThan(0);
    expect(screen.queryByText(":yes-party:")).toBeNull();
    expect(screen.getAllByText("🚀").length).toBeGreaterThan(0);
  });
});
