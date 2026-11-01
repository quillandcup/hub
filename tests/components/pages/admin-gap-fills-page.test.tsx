// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { renderServerPage, resetServerPageMocks, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));
const requireAdminPage = vi.fn(async () => undefined);
vi.mock("@/lib/admin-auth", () => ({ requireAdminPage: () => requireAdminPage() }));

import ChatGapFillsPage from "@/app/(admin)/admin/data-health/gap-fills/page";

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const fill = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  source: "webhook",
  scope: "message",
  slack_channel_id: "C_GENERAL",
  slack_ts: "1.1",
  started_at: hoursAgo(1),
  finished_at: hoursAgo(1),
  messages_recovered: 0,
  reactions_recovered: 0,
  messages_seen: 0,
  error: null,
  ...extra,
});
const CHANNELS = [
  { id: "chn_AAAAAAAAAAA1", slack_channel_id: "C_GENERAL", name: "general", kind: "channel" },
  { id: "chn_AAAAAAAAAAA2", slack_channel_id: "G_GROUP", name: null, kind: "group_dm" },
];

// The gap-fill and channel rows come from the in-memory chat repository.
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));
const seedChat = (fills: ReturnType<typeof fill>[], channels = CHANNELS) => {
  repos = createInMemoryRepos(new InMemoryDataset({ chatGapFills: fills, chatChannels: channels }));
};

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
  repos = createInMemoryRepos();
  useFakeSupabase({});
});

describe("admin chat gap-fills page", () => {
  it("is for admins: it starts by requiring one", async () => {
    seedChat([], []);
    await renderServerPage(ChatGapFillsPage, {});
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("shows no fills (and logs) when they can't be read, and bare Slack ids when the channels can't", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    seedChat([]);
    vi.spyOn(repos.chat, "recentGapFills").mockRejectedValue(new Error("fills boom"));
    await renderServerPage(ChatGapFillsPage, {});
    expect(screen.getByText("No gap-fills yet.")).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(expect.any(String), "fills boom");

    seedChat([fill("a")]);
    vi.spyOn(repos.chat, "channelLabelsBySlackId").mockRejectedValue(new Error("channels boom"));
    await renderServerPage(ChatGapFillsPage, {});
    expect(screen.getByText("C_GENERAL")).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(expect.any(String), "channels boom");
    log.mockRestore();
  });

  it("says so when there are no fills yet, with zeros for the last day", async () => {
    seedChat([], []);
    await renderServerPage(ChatGapFillsPage, {});

    expect(screen.getByText("No gap-fills yet.")).toBeInTheDocument();
    const tiles = within(screen.getByRole("region", { name: "Last 24 hours" }));
    expect(tiles.getAllByText("0")).toHaveLength(3);
  });

  it("lists each fill with its conversation, what it fetched, what triggered it, how much it recovered and how it ended", async () => {
    // Newest first, as the repository lists them.
    seedChat([
      fill("a", { started_at: hoursAgo(1), scope: "channel", source: "open", slack_ts: null, messages_recovered: 4, reactions_recovered: 2, messages_seen: 17 }),
      fill("b", { started_at: hoursAgo(2), slack_channel_id: "G_GROUP", scope: "thread", error: "not_in_channel", finished_at: hoursAgo(1) }),
      fill("c", { started_at: hoursAgo(3), scope: "message", finished_at: null }),
      fill("d", { started_at: hoursAgo(4), slack_channel_id: "C_UNKNOWN", source: "manual" }),
    ]);
    await renderServerPage(ChatGapFillsPage, {});

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("#general")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Catch-up on open")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Opening a conversation")).toBeInTheDocument();
    // What Slack returned (new or not) is shown apart from what was new to us.
    expect(within(rows[0]).getByText("17")).toBeInTheDocument();
    expect(within(rows[0]).getByText("4")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Done")).toBeInTheDocument();

    expect(within(rows[1]).getByText("Group message")).toBeInTheDocument();
    expect(within(rows[1]).getByText("A thread")).toBeInTheDocument();
    expect(within(rows[1]).getByText("not_in_channel")).toBeInTheDocument();

    expect(within(rows[2]).getByText("Running or interrupted")).toBeInTheDocument();
    expect(within(rows[2]).getByText("A Slack event")).toBeInTheDocument();
    // A conversation the chat no longer knows shows its Slack id; a source nobody labelled shows as it is.
    expect(within(rows[3]).getByText("C_UNKNOWN")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Run by hand")).toBeInTheDocument();
  });

  it("totals only the last 24 hours: fills, what they recovered and how many failed", async () => {
    seedChat([
      fill("recent-1", { messages_recovered: 3, reactions_recovered: 1 }),
      fill("recent-2", { messages_recovered: 2, error: "not_in_channel" }),
      fill("old", { started_at: hoursAgo(48), messages_recovered: 50, error: "boom" }),
    ]);
    await renderServerPage(ChatGapFillsPage, {});

    const tiles = screen.getByRole("region", { name: "Last 24 hours" });
    const value = (label: string) => within(within(tiles).getByText(new RegExp(label)).parentElement as HTMLElement).getByText(/^\d+$/).textContent;
    expect(value("Fills")).toBe("2");
    expect(value("Messages and reactions recovered")).toBe("6");
    expect(value("Failed")).toBe("1");
  });
});
