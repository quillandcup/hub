// @vitest-environment jsdom
// The member page's Slack tab pages on the server: the panel shows the page it is given and
// writes filters, sort and paging to the URL.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const push = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/admin/members/mbr_1/slack",
  useSearchParams: () => new URLSearchParams(search),
}));

import MemberSlackActivityPanel, { type SlackPageData } from "@/app/(admin)/admin/members/[id]/MemberSlackActivityPanel";

const activity = (id: string, channel: string) => ({
  id,
  activity_type: "slack_message",
  occurred_at: "2026-09-01T10:00:00Z",
  description: `message ${id}`,
  data: { channel_name: channel },
});
const summary = { total: 120, messages: 101, reactions: 19, channels: 2, last30Days: 7 };
const page = (extra: Partial<SlackPageData> = {}): SlackPageData => ({
  rows: [activity("1", "writing"), activity("2", "announcements")],
  total: 120,
  page: 1,
  pageSize: 50,
  kind: "all",
  channel: null,
  channels: [
    { name: "writing", count: 90 },
    { name: "announcements", count: 30 },
  ],
  ...extra,
});

describe("MemberSlackActivityPanel", () => {
  beforeEach(() => {
    push.mockClear();
    search = "";
  });

  it("shows the served rows in the order given and the totals from the summary", () => {
    render(<MemberSlackActivityPanel slackPage={page()} slackSummary={summary} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/^#/).map((c) => c.textContent)).toEqual(["#writing", "#announcements"]);
    expect(screen.getByText("101")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("sorts through the URL: a header click asks the server, from page 1", async () => {
    search = "page=3";
    render(<MemberSlackActivityPanel slackPage={page({ page: 3 })} slackSummary={summary} />);
    await userEvent.click(within(screen.getByRole("table")).getByText("Channel"));
    expect(push).toHaveBeenCalledWith("/admin/members/mbr_1/slack?sort=channel&dir=asc");
  });

  it("filters by kind and channel through the URL and clears the channel", async () => {
    render(<MemberSlackActivityPanel slackPage={page()} slackSummary={summary} />);
    await userEvent.click(screen.getByRole("button", { name: "Messages" }));
    expect(push).toHaveBeenLastCalledWith("/admin/members/mbr_1/slack?type=messages");
    await userEvent.click(screen.getByRole("button", { name: "#announcements" }));
    expect(push).toHaveBeenLastCalledWith("/admin/members/mbr_1/slack?channel=announcements");
  });

  it("drops the filter and the page when All or (clear filter) is picked", async () => {
    search = "type=reactions&channel=writing&page=2";
    render(<MemberSlackActivityPanel slackPage={page({ kind: "reactions", channel: "writing", page: 2 })} slackSummary={summary} />);
    await userEvent.click(screen.getByRole("button", { name: "All" }));
    expect(push).toHaveBeenLastCalledWith("/admin/members/mbr_1/slack?channel=writing");
    await userEvent.click(screen.getByRole("button", { name: "(clear filter)" }));
    expect(push).toHaveBeenLastCalledWith("/admin/members/mbr_1/slack?type=reactions");
  });

  it("pages through the URL when there is more than one page", async () => {
    render(<MemberSlackActivityPanel slackPage={page()} slackSummary={summary} />);
    await userEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(push).toHaveBeenLastCalledWith("/admin/members/mbr_1/slack?page=2");
  });

  it("shows the empty state for a member with no Slack activity", () => {
    render(
      <MemberSlackActivityPanel
        slackPage={page({ rows: [], total: 0, channels: [] })}
        slackSummary={{ total: 0, messages: 0, reactions: 0, channels: 0, last30Days: 0 }}
      />
    );
    expect(screen.getByText("No Slack Activity")).toBeInTheDocument();
  });
});
