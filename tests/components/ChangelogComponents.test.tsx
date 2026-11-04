// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const track = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/client", () => ({ track }));

import ChangelogEntryViewed from "@/components/changelog/ChangelogEntryViewed";
import ChangelogMarkdown from "@/components/changelog/ChangelogMarkdown";

beforeEach(() => track.mockClear());

describe("ChangelogEntryViewed", () => {
  it("records the entry once and renders nothing", () => {
    const { container, rerender } = render(<ChangelogEntryViewed slug="a-thing" />);
    rerender(<ChangelogEntryViewed slug="a-thing" />);
    expect(track.mock.calls).toEqual([["changelog_entry_viewed", { slug: "a-thing" }]]);
    expect(container.innerHTML).toBe("");
  });
});

describe("ChangelogMarkdown", () => {
  it("shows the entry's own screenshots and drops any other image", () => {
    render(
      <ChangelogMarkdown
        slug="a-thing"
        markdown={"Hello **there**.\n\n![mine](/changelog/a-thing/one.png)\n\n![theirs](https://example.com/x.png)\n\n![other](/changelog/other/y.png)"}
      />,
    );
    expect(screen.getByText("there")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "mine" })).toHaveAttribute("src", "/changelog/a-thing/one.png");
    expect(screen.queryByRole("img", { name: "theirs" })).toBeNull();
    expect(screen.queryByRole("img", { name: "other" })).toBeNull();
  });

  it("keeps web and Hub links and strips scripts", () => {
    render(<ChangelogMarkdown slug="a-thing" markdown={"[hub](/help) [bad](javascript:alert(1))"} />);
    expect(screen.getByRole("link", { name: "hub" })).toHaveAttribute("href", "/help");
    expect(screen.queryByRole("link", { name: "bad" })?.getAttribute("href") ?? "").toBe("");
  });
});
