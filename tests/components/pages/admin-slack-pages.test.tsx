// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderServerPage, resetServerPageMocks } from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: vi.fn(async () => undefined), requireStaffPage: vi.fn(async () => ({ id: "admin", email: "a@example.test", role: "admin" })) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: "user-1", email: "admin@example.test" })) }));
vi.mock("@/lib/timezone", () => ({ getViewerTimeZone: vi.fn(async () => "UTC") }));
let dataset = new InMemoryDataset();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: (_db: unknown, options?: { slackWorkspaceId?: string }) => createInMemoryRepos(dataset, options),
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
    dataset = new InMemoryDataset({
        slackChannels: [
          { channel_id: "C_B", name: "back-room", is_private: true, member_count: 4 },
          { channel_id: "C_A", name: "open-house", is_private: false, is_archived: true },
          { channel_id: "C_G", name: "mpdm-fake-group", is_private: true, is_mpim: true },
        ],
        restrictedSlackChannels: [{ channel_id: "C_B", created_at: "2026-10-01T12:00:00Z" }],
    });

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
    dataset = new InMemoryDataset({
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
    });

    await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({}) });

    expect(screen.getByText("Slack Engagement")).toBeInTheDocument();
    expect(charts).toHaveBeenCalled();
    const props = JSON.stringify(charts.mock.calls[0][0]);
    expect(props).toContain("open-house");
    expect(props).not.toContain("mpdm-fake-group");
  });

  describe("with two Slack workspaces", () => {
    const primary = "slws_AAAAAAAAAAA1";
    const second = "slws_AAAAAAAAAAA2";
    const today = new Date().toISOString();
    const seed = () => {
      // Both workspaces have a channel with the same Slack id, and one message in it.
      dataset = new InMemoryDataset({
        slackWorkspaces: [
          { id: primary, team_id: "T_ONE", name: "Quill & Cup", url: null, is_primary: true, created_at: today, deleted_at: null },
          { id: second, team_id: "T_TWO", name: "180 Program", url: null, is_primary: false, created_at: today, deleted_at: null },
        ],
        slackChannels: [
          { channel_id: "C_SAME", name: "general", is_private: false, workspace_id: primary },
          { channel_id: "C_SAME", name: "cohort", is_private: false, workspace_id: second },
        ],
        slackMessages: [
          { channel_id: "C_SAME", message_ts: "1.1", user_id: "U_FAKE1", occurred_at: today, channel_name: "general", workspace_id: primary },
          { channel_id: "C_SAME", message_ts: "1.1", user_id: "U_FAKE2", occurred_at: today, channel_name: "cohort", workspace_id: second },
          { channel_id: "C_SAME", message_ts: "1.2", user_id: "U_FAKE2", occurred_at: today, channel_name: "cohort", workspace_id: second },
        ],
      });
    };

    it("combines them by default, keeping same-id channels apart and naming the workspace", async () => {
      seed();
      await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({}) });

      expect(screen.getByText(/All workspaces/, { selector: "p" })).toBeInTheDocument();
      const props = charts.mock.calls[0][0] as { channels: { name: string; messages: number }[] };
      const names = props.channels.map((c) => c.name).sort();
      expect(names).toEqual(["cohort (180 Program)", "general (Quill & Cup)"]);
      expect(props.channels.find((c) => c.name.startsWith("cohort"))).toMatchObject({ messages: 2 });
      expect(props.channels.find((c) => c.name.startsWith("general"))).toMatchObject({ messages: 1 });
      // The links go by Slack team id, never a Hub id.
      expect(screen.getByRole("link", { name: "180 Program" })).toHaveAttribute("href", expect.stringContaining("workspace=T_TWO"));
      expect(JSON.stringify(document.body.innerHTML)).not.toContain("slws_");
    });

    it("shows one workspace when the filter names its team", async () => {
      seed();
      await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({ workspace: "T_TWO" }) });

      const props = charts.mock.calls[0][0] as { channels: { name: string; messages: number }[] };
      expect(props.channels.map((c) => c.name)).toEqual(["cohort"]);
      expect(props.channels[0].messages).toBe(2);
      expect(screen.getByRole("link", { name: "180 Program" })).toHaveAttribute("aria-current", "page");
    });

    it("ignores a workspace filter it does not know and shows the combined view", async () => {
      seed();
      await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({ workspace: "T_NOBODY" }) });
      const props = charts.mock.calls[0][0] as { channels: unknown[] };
      expect(props.channels).toHaveLength(2);
    });

    it("has no workspace filter with a single workspace", async () => {
      dataset = new InMemoryDataset();
      await renderServerPage(SlackEngagementPage, { searchParams: Promise.resolve({}) });
      expect(screen.queryByRole("navigation", { name: "Slack workspace" })).not.toBeInTheDocument();
    });
  });
});
