// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-1", email: "admin@example.test" })) }));
vi.mock("@/lib/timezone", () => ({ getViewerTimeZone: vi.fn(async () => "UTC") }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
vi.mock("@/app/(admin)/admin/data/slack-channels/RestrictionToggle", () => ({ default: ({ channelId }: { channelId: string }) => <span>toggle {channelId}</span> }));
const charts = vi.fn();
vi.mock("@/app/(admin)/admin/insights/slack-engagement/SlackEngagementCharts", () => ({
  default: (props: unknown) => {
    charts(props);
    return null;
  },
}));
vi.mock("@/app/(admin)/admin/stats/DateRangeFilter", () => ({ default: () => null }));

import SlackChannelsPage from "@/app/(admin)/admin/data/slack-channels/page";
import SlackEngagementPage from "@/app/(admin)/admin/insights/slack-engagement/page";

beforeEach(() => {
  resetServerPageMocks();
  charts.mockClear();
});

describe("Slack channels page", () => {
  it("lists channels (not group DMs) and who restricted which", async () => {
    repos = createInMemoryRepos(
      new InMemoryDataset({
        slackChannels: [
          { channel_id: "C_B", name: "back-room", is_private: true, member_count: 4 },
          { channel_id: "C_A", name: "open-house", is_private: false, is_archived: true },
          { channel_id: "C_G", name: "mpdm-fake-group", is_private: true, is_mpim: true },
        ],
        restrictedSlackChannels: [{ channel_id: "C_B", created_at: "2026-10-01T12:00:00Z" }],
      }),
    );

    await renderServerPage(SlackChannelsPage, {});

    expect(screen.getByText("#back-room")).toBeInTheDocument();
    expect(screen.getByText("#open-house")).toBeInTheDocument();
    expect(screen.queryByText(/mpdm-fake-group/)).not.toBeInTheDocument();
    expect(screen.getByText(/No, restricted/)).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();
  });
});

describe("Slack engagement page", () => {
  it("reads live messages and reactions, and keeps group DMs out of the channel tables", async () => {
    const today = new Date().toISOString();
    repos = createInMemoryRepos(
      new InMemoryDataset({
        slackChannels: [
          { channel_id: "C_A", name: "open-house", is_private: false },
          { channel_id: "C_G", name: "mpdm-fake-group", is_private: true, is_mpim: true },
        ],
        slackMessages: [
          { channel_id: "C_A", message_ts: "1.1", user_id: "U_FAKE1", occurred_at: today },
          { channel_id: "C_G", message_ts: "1.2", user_id: "U_FAKE2", occurred_at: today },
          { channel_id: "C_A", message_ts: "1.3", user_id: "U_FAKE1", occurred_at: today, deleted_at: today },
        ],
        slackReactions: [{ channel_id: "C_A", message_ts: "1.1", user_id: "U_FAKE2", reaction: "tada", occurred_at: today }],
      }),
    );

    await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByText("Slack Engagement")).toBeInTheDocument();
    expect(charts).toHaveBeenCalled();
    const props = JSON.stringify(charts.mock.calls[0][0]);
    expect(props).toContain("open-house");
    expect(props).not.toContain("mpdm-fake-group");
  });
});
