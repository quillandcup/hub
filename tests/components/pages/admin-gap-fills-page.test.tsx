// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
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
  error: null,
  ...extra,
});
const CHANNELS = [
  { slack_channel_id: "C_GENERAL", name: "general", kind: "channel" },
  { slack_channel_id: "G_GROUP", name: null, kind: "group_dm" },
];

beforeEach(() => {
  resetServerPageMocks();
  requireAdminPage.mockClear();
});

describe("admin chat gap-fills page", () => {
  it("is for admins: it starts by requiring one", async () => {
    useFakeSupabase({ chat_gap_fills: { data: [] }, chat_channels: { data: [] } });
    await renderServerPage(ChatGapFillsPage, {});
    expect(requireAdminPage).toHaveBeenCalledTimes(1);
  });

  it("says so when there are no fills yet, with zeros for the last day", async () => {
    useFakeSupabase({ chat_gap_fills: { data: [] }, chat_channels: { data: [] } });
    await renderServerPage(ChatGapFillsPage, {});

    expect(screen.getByText("No gap-fills yet.")).toBeInTheDocument();
    const tiles = within(screen.getByRole("region", { name: "Last 24 hours" }));
    expect(tiles.getAllByText("0")).toHaveLength(3);
  });

  it("lists each fill with its conversation, what it fetched, what triggered it, how much it recovered and how it ended", async () => {
    useFakeSupabase({
      chat_gap_fills: {
        data: [
          fill("a", { scope: "channel", source: "open", slack_ts: null, messages_recovered: 4, reactions_recovered: 2 }),
          fill("b", { slack_channel_id: "G_GROUP", scope: "thread", error: "not_in_channel", finished_at: hoursAgo(1) }),
          fill("c", { scope: "message", finished_at: null }),
          fill("d", { slack_channel_id: "C_UNKNOWN", source: "manual" }),
        ],
      },
      chat_channels: { data: CHANNELS },
    });
    await renderServerPage(ChatGapFillsPage, {});

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("#general")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Catch-up on open")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Opening a conversation")).toBeInTheDocument();
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
    useFakeSupabase({
      chat_gap_fills: {
        data: [
          fill("recent-1", { messages_recovered: 3, reactions_recovered: 1 }),
          fill("recent-2", { messages_recovered: 2, error: "not_in_channel" }),
          fill("old", { started_at: hoursAgo(48), messages_recovered: 50, error: "boom" }),
        ],
      },
      chat_channels: { data: CHANNELS },
    });
    await renderServerPage(ChatGapFillsPage, {});

    const tiles = screen.getByRole("region", { name: "Last 24 hours" });
    const value = (label: string) => within(within(tiles).getByText(new RegExp(label)).parentElement as HTMLElement).getByText(/^\d+$/).textContent;
    expect(value("Fills")).toBe("2");
    expect(value("Messages and reactions recovered")).toBe("6");
    expect(value("Failed")).toBe("1");
  });
});
