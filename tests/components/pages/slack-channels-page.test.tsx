// @vitest-environment jsdom
/**
 * /admin/data/slack-channels: which channels staff can read messages in, and the actions that
 * restrict a private channel or lift the restriction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  ADMIN_USER,
  MEMBER_USER,
  renderServerPage,
  resetServerPageMocks,
  signInAs,
  ROLE_PROFILES,
} from "@/tests/helpers/server-page";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

vi.mock("next/navigation", () => import("@/tests/helpers/server-page").then((m) => m.nextNavigationModule));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => import("@/tests/helpers/server-page").then((m) => m.authModule));
vi.mock("@/lib/supabase/server", () => import("@/tests/helpers/server-page").then((m) => m.supabaseServerModule));

// Roles, channels and restrictions come from the repositories, in memory here.
let repos: Repos;
let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const triggerReprocessing = vi.fn<(...args: unknown[]) => Promise<{ processed: { table: string; success: boolean }[] }>>(
  async () => ({ processed: [{ table: "slack", success: true }] })
);
vi.mock("@/lib/processing/trigger", () => ({ triggerReprocessing: (...args: unknown[]) => triggerReprocessing(...args) }));

const { default: SlackChannelsPage } = await import("@/app/(admin)/admin/data/slack-channels/page");
const { restrictSlackChannel, unrestrictSlackChannel } = await import("@/app/(admin)/admin/data/slack-channels/actions");

const CHANNELS = [
  { channel_id: "C_PUBLIC", name: "general", is_private: false, is_archived: false, is_mpim: false, member_count: 80 },
  { channel_id: "C_OPEN", name: "hosts", is_private: true, is_archived: false, is_mpim: false, member_count: 6 },
  { channel_id: "C_QUIET", name: "inner-circle", is_private: true, is_archived: false, is_mpim: false, member_count: 4 },
  { channel_id: "G_DM", name: "mpdm-fern--bramble-1", is_private: true, is_mpim: true, is_archived: false, member_count: 2 },
];

/** The channel ids staff are currently kept from reading. */
const restricted = async () => [...(await repos.slackWorkspace.restrictedChannels()).keys()].sort();

beforeEach(() => {
  resetServerPageMocks();
  triggerReprocessing.mockClear();
  dataset = new InMemoryDataset({
    userProfiles: ROLE_PROFILES,
    slackChannels: CHANNELS,
    restrictedSlackChannels: [{ channel_id: "C_QUIET", name: "inner-circle", created_at: "2026-10-01T12:00:00Z" }],
  });
  repos = createInMemoryRepos(dataset);
  signInAs(ADMIN_USER);
});

describe("Slack Channels page", () => {
  it("shows which channels staff can read and offers the toggle only where it applies", async () => {
    await renderServerPage(SlackChannelsPage, {});

    const row = (name: string) => screen.getByText(name).closest("tr")!;
    expect(within(row("#general")).getByText("Yes")).toBeInTheDocument();
    expect(within(row("#general")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(row("#hosts")).getByRole("button", { name: "Restrict" })).toBeInTheDocument();
    expect(within(row("#inner-circle")).getByText(/^No, restricted/)).toBeInTheDocument();
    expect(within(row("#inner-circle")).getByRole("button", { name: "Lift restriction" })).toBeInTheDocument();

    // Group DMs are never listed by name (the name is the member list).
    expect(screen.queryByText(/mpdm-fern/)).not.toBeInTheDocument();
    expect(screen.getByText(/1 group DM and all direct messages are always restricted/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "activity log" })).toHaveAttribute("href", "/admin/activity?view=privacy");
  });
});

describe("restrictSlackChannel / unrestrictSlackChannel", () => {
  it("refuses a non-admin", async () => {
    signInAs(MEMBER_USER);
    await expect(restrictSlackChannel("C_OPEN")).resolves.toEqual({ error: "Not authorized" });
    await expect(unrestrictSlackChannel("C_QUIET")).resolves.toEqual({ error: "Not authorized" });
    expect(await restricted()).toEqual(["C_QUIET"]);
  });

  it("restricts a private channel, recording its name for the audit log", async () => {
    await expect(restrictSlackChannel("C_OPEN")).resolves.toEqual({ success: true });
    expect(await restricted()).toEqual(["C_OPEN", "C_QUIET"]);
    expect(dataset.restrictedSlackChannels.find((r) => r.channel_id === "C_OPEN")?.name).toBe("hosts");
    // The table's trigger clears the copied text; no rebuild needed.
    expect(triggerReprocessing).not.toHaveBeenCalled();
  });

  it("only restricts private channels", async () => {
    await expect(restrictSlackChannel("C_PUBLIC")).resolves.toEqual({ error: "Only private channels can be restricted" });
    await expect(restrictSlackChannel("G_DM")).resolves.toEqual({ error: "Only private channels can be restricted" });
    await expect(restrictSlackChannel("C_MISSING")).resolves.toEqual({ error: "Channel not found" });
    expect(await restricted()).toEqual(["C_QUIET"]);
  });

  it("lifts a restriction and rebuilds Slack activity so the text comes back", async () => {
    await expect(unrestrictSlackChannel("C_QUIET")).resolves.toEqual({ success: true });
    expect(await restricted()).toEqual([]);
    expect(triggerReprocessing).toHaveBeenCalledWith("restricted_slack_channels", "local");
  });
});
