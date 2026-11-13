// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/app/(member)/chat/actions", () => ({ hideChatUnfurl: vi.fn() }));
vi.mock("@/app/actions/member-hover-card", () => ({ getMemberHoverCard: vi.fn() }));
import MessageUnfurls from "@/components/chat/MessageUnfurls";
import { previewToCard, withLinkPreviews } from "@/lib/chat/link-preview-cards";

afterEach(cleanup);

const ctx = { userNames: {}, userMembers: {}, channelIds: {}, channelNames: {}, customEmoji: {} };
const removable = { channelId: "chn_AAAAAAAAAAA1", messageId: "msg_AAAAAAAAAAA9" };
const base = { messageId: "msg_AAAAAAAAAAA9", position: 0, fetchedAt: "2026-10-01T00:00:00Z", status: "ok" as const };
const page = () =>
  withLinkPreviews([], [{ ...base, url: "https://example.test/post", finalUrl: "https://example.test/post", kind: "link", title: "A page", description: "About it", siteName: "Example", imageUrl: "https://example.test/c.png" }]);
const picture = () => [previewToCard({ ...base, url: "https://example.test/a.jpg", finalUrl: "https://example.test/a.jpg", kind: "image", title: null, description: null, siteName: null, imageUrl: "https://example.test/a.jpg" })!];

describe("where the X sits", () => {
  it("is in the left gutter, beside the card's top, for a page preview", () => {
    render(<MessageUnfurls unfurls={page()} ctx={ctx} permalink={null} removable={removable} />);
    const x = screen.getByRole("button", { name: "Remove preview" });
    expect(x).toHaveAttribute("data-placement", "gutter");
    expect(x.className).toContain("right-full");
    expect(x.className).toContain("top-0");
    expect(screen.getByTestId("unfurl-card")).toContainElement(x);
    expect(screen.getByTestId("unfurl-card").className).toContain("group");
  });

  it("is on the picture's top-right corner for a link straight to a picture, which has no card box", () => {
    render(<MessageUnfurls unfurls={picture()} ctx={ctx} permalink={null} removable={removable} />);
    const x = screen.getByRole("button", { name: "Remove preview" });
    expect(x).toHaveAttribute("data-placement", "corner");
    expect(x.className).toContain("-right-2");
    expect(x.className).toContain("-top-2");
    expect(screen.queryByTestId("unfurl-card")).toBeNull();
    expect(screen.getByTestId("unfurl-picture-card")).toContainElement(x);
  });

  it("shows on hover, on keyboard focus and always where hover is unavailable, with a tooltip", () => {
    for (const unfurls of [page(), picture()]) {
      cleanup();
      render(<MessageUnfurls unfurls={unfurls} ctx={ctx} permalink={null} removable={removable} />);
      const x = screen.getByRole("button", { name: "Remove preview" });
      expect(x.className).toContain("opacity-0");
      expect(x.className).toContain("group-hover:opacity-100");
      expect(x.className).toContain("focus-visible:opacity-100");
      expect(x.className).toContain("[@media(hover:none)]:opacity-100");
      expect(screen.getByTestId("remove-preview-tip")).toHaveTextContent("Remove preview");
      expect(x.className).toContain("group/x");
      x.focus();
      expect(x).toHaveFocus();
    }
  });

  it("is absent for a picture unless the viewer is the author (and not in sudo)", () => {
    render(<MessageUnfurls unfurls={picture()} ctx={ctx} permalink={null} />);
    expect(screen.queryByRole("button", { name: "Remove preview" })).toBeNull();
    expect(screen.getByTestId("unfurl-picture-card")).toBeInTheDocument();
  });
});
