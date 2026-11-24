// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const getMemberHoverCard = vi.fn();
vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: (...a: unknown[]) => getMemberHoverCard(...a) }));
const track = vi.fn();
vi.mock("@/lib/analytics/client", () => ({ track: (...a: unknown[]) => track(...a) }));

import { MemberAvatarLink, MemberNameLink } from "@/components/member/MemberAvatarLink";

const card = { id: "mbr_ada", name: "Ada Example", photoUrl: null, firstJoinedAt: null, askMeAbout: [], instagramUrl: null, facebookUrl: null, twitterUrl: null, messageUrl: null };

beforeEach(() => {
  getMemberHoverCard.mockReset().mockResolvedValue({ card });
  track.mockReset();
});
afterEach(() => cleanup());

async function hoverFor(el: Element) {
  vi.useFakeTimers();
  fireEvent.pointerEnter(el, { pointerType: "mouse" });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  vi.useRealTimers();
}

describe("MemberAvatarLink and MemberNameLink", () => {
  it("shows the photo at the given size, or the initials without one", () => {
    const { container, rerender } = render(<MemberAvatarLink memberId="mbr_ada" name="Ada Example" photoUrl="https://img.example.test/ada.png" size={24} surface="lesson_comments" href="/members/mbr_ada" trackName="t" />);
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", "https://img.example.test/ada.png");
    expect(img).toHaveAttribute("width", "24");
    rerender(<MemberAvatarLink memberId="mbr_ada" name="Ada Example" photoUrl={null} size={32} surface="lesson_comments" href="/members/mbr_ada" trackName="t" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("AE");
  });

  it("keeps the avatar link out of the tab order and the accessibility tree, so the name is the one stop", async () => {
    render(
      <div>
        <MemberAvatarLink memberId="mbr_ada" name="Ada Example" photoUrl={null} size={32} surface="lesson_comments" href="/members/mbr_ada" trackName="avatar-track" />
        <MemberNameLink memberId="mbr_ada" name="Ada Example" surface="lesson_comments" href="/members/mbr_ada" trackName="name-track" />
      </div>,
    );
    const avatarLink = document.querySelector('a[data-track="avatar-track"]')!;
    expect(avatarLink).toHaveAttribute("aria-hidden", "true");
    expect(avatarLink).toHaveAttribute("tabindex", "-1");
    expect(avatarLink).toHaveAttribute("href", "/members/mbr_ada");
    expect(screen.getAllByRole("link")).toHaveLength(1);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Ada Example" })).toHaveFocus();
    expect(screen.getByRole("link", { name: "Ada Example" })).toHaveAttribute("data-track", "name-track");
  });

  it("opens the member card from the avatar and from the name, with the surface", async () => {
    render(
      <div>
        <MemberAvatarLink memberId="mbr_ada" name="Ada Example" photoUrl={null} size={32} surface="lesson_comments" href="/members/mbr_ada" trackName="a" />
      </div>,
    );
    await hoverFor(document.querySelector("a")!);
    expect(screen.getByRole("dialog", { name: "Member profile" })).toBeInTheDocument();
    expect(getMemberHoverCard).toHaveBeenCalledWith("mbr_ada");
    expect(track).toHaveBeenCalledWith("member_hover_card_opened", { surface: "lesson_comments", has_message: false });
    cleanup();
    getMemberHoverCard.mockClear();

    // Another member: the first one's card is already cached for this page load.
    render(<MemberNameLink memberId="mbr_bea" name="Bea Example" surface="chat" href="/members/mbr_bea" trackName="n" />);
    await hoverFor(screen.getByRole("link", { name: "Bea Example" }));
    expect(getMemberHoverCard).toHaveBeenCalledWith("mbr_bea");
  });

  it("is plain, with no link or card, for a person without a member id", () => {
    const { container } = render(
      <div>
        <MemberAvatarLink memberId={null} name="Slack Person" photoUrl={null} size={36} surface="chat" href="/x" trackName="a" />
        <MemberNameLink memberId={undefined} name="Slack Person" surface="chat" href="/x" trackName="n" />
      </div>,
    );
    expect(container.querySelector("a")).toBeNull();
    expect(container).toHaveTextContent("SP");
    expect(screen.getByText("Slack Person")).toHaveClass("font-semibold");
  });
});
