// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const getMemberHoverCard = vi.fn();
vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: (...a: unknown[]) => getMemberHoverCard(...a) }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

import Link from "next/link";
import MemberHoverCard from "@/components/member/MemberHoverCard";

const card = (overrides = {}) => ({
  id: "mbr_ada",
  name: "Ada Example",
  photoUrl: null,
  firstJoinedAt: "2025-03-10",
  askMeAbout: ["Plotting"],
  instagramUrl: null,
  facebookUrl: null,
  twitterUrl: null,
  messageUrl: "https://slack.example.test/dm",
  ...overrides,
});

async function hover(name: string) {
  fireEvent.pointerEnter(screen.getAllByText(name)[0], { pointerType: "mouse" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getMemberHoverCard.mockReset();
  track.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MemberHoverCard", () => {
  it("shows nothing until hovered, then the profile with Message and View profile", async () => {
    getMemberHoverCard.mockResolvedValue({ card: card({ id: "mbr_hover_1" }) });
    render(<MemberHoverCard memberId="mbr_hover_1" surface="streaks"><Link href="/members/mbr_hover_1">Ada Example</Link></MemberHoverCard>);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getMemberHoverCard).not.toHaveBeenCalled();

    await hover("Ada Example");
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Hedgie since March 2025");
    expect(screen.getByRole("link", { name: "Message" })).toHaveAttribute("href", "https://slack.example.test/dm");
    expect(screen.getByRole("link", { name: "View profile" })).toHaveAttribute("href", "/members/mbr_hover_1");
    expect(screen.getByText("Plotting")).toBeInTheDocument();
    expect(track).toHaveBeenCalledWith("member_hover_card_opened", { surface: "streaks", has_message: true });
  });

  it("leaves Message out when the member has no Slack account", async () => {
    getMemberHoverCard.mockResolvedValue({ card: card({ id: "mbr_hover_2", messageUrl: null }) });
    render(<MemberHoverCard memberId="mbr_hover_2" surface="chat"><span>Ada Example</span></MemberHoverCard>);
    await hover("Ada Example");
    expect(screen.queryByRole("link", { name: "Message" })).toBeNull();
    expect(track).toHaveBeenCalledWith("member_hover_card_opened", { surface: "chat", has_message: false });
  });

  it("closes after the pointer leaves, and on Escape", async () => {
    getMemberHoverCard.mockResolvedValue({ card: card({ id: "mbr_hover_3" }) });
    render(<MemberHoverCard memberId="mbr_hover_3" surface="chat"><span>Ada Example</span></MemberHoverCard>);
    await hover("Ada Example");
    fireEvent.pointerLeave(screen.getAllByText("Ada Example")[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    await hover("Ada Example");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores touch hovers and a quick pass-over", async () => {
    render(<MemberHoverCard memberId="mbr_hover_4" surface="chat"><span>Ada Example</span></MemberHoverCard>);
    fireEvent.pointerEnter(screen.getAllByText("Ada Example")[0], { pointerType: "touch" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.pointerEnter(screen.getAllByText("Ada Example")[0], { pointerType: "mouse" });
    fireEvent.pointerLeave(screen.getAllByText("Ada Example")[0]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(getMemberHoverCard).not.toHaveBeenCalled();
  });

  it("opens on keyboard focus and says so when the profile can't load", async () => {
    getMemberHoverCard.mockResolvedValue({ error: "This member isn't available." });
    render(<MemberHoverCard memberId="mbr_hover_5" surface="big_sisters"><a href="/x">Ada Example</a></MemberHoverCard>);
    fireEvent.focus(screen.getByRole("link", { name: "Ada Example" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.getByRole("dialog")).toHaveTextContent("This member isn't available.");
    expect(track).not.toHaveBeenCalled();
  });

  it("fetches a member once per page load", async () => {
    getMemberHoverCard.mockResolvedValue({ card: card({ id: "mbr_hover_6" }) });
    const { unmount } = render(<MemberHoverCard memberId="mbr_hover_6" surface="chat"><span>Ada Example</span></MemberHoverCard>);
    await hover("Ada Example");
    unmount();
    render(<MemberHoverCard memberId="mbr_hover_6" surface="chat"><span>Ada Example</span></MemberHoverCard>);
    await hover("Ada Example");
    expect(screen.getByRole("dialog")).toHaveTextContent("Ada Example");
    expect(getMemberHoverCard).toHaveBeenCalledTimes(1);
  });
});
