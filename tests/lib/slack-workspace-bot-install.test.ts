import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const access = vi.fn();
vi.mock("@slack/web-api", () => ({
  WebClient: vi.fn(function () {
    return { oauth: { v2: { access } } };
  }),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

let dataset: InMemoryDataset;
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { botInstallState, botInstallTarget, buildBotInstallUrl, completeBotInstall, isBotInstallTarget } from "@/lib/slack-bot-install";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const rpc = vi.fn();
const service = { rpc } as never as import("@supabase/supabase-js").SupabaseClient;
const granted = (team: { id: string; name: string }) => ({ ok: true, access_token: "xoxe.xoxb-new", refresh_token: "xoxe-1-new", expires_in: 43200, team, bot_user_id: "U_BOT" });

beforeEach(() => {
  dataset = new InMemoryDataset();
  access.mockReset();
  rpc.mockReset();
  rpc.mockResolvedValue({ error: null });
  vi.stubEnv("SLACK_CLIENT_ID", "client-1");
  vi.stubEnv("SLACK_CLIENT_SECRET", "secret-1");
  vi.stubEnv("SLACK_TEAM_ID", "T_PRIMARY");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("which workspace an install is for", () => {
  it("travels in the OAuth state as a Slack team id (never a Hub id), and falls back to the primary workspace", () => {
    expect(botInstallState("new", "abc")).toBe("bot.new.abc");
    expect(botInstallTarget("bot.new.abc")).toBe("new");
    expect(botInstallTarget("bot.TTEAM123.abc")).toBe("TTEAM123");
    // The older form, and anything malformed, mean the primary workspace.
    expect(botInstallTarget("bot.abc")).toBe("primary");
    expect(botInstallTarget("bot.bad target.abc")).toBe("primary");
    expect(botInstallTarget(null)).toBe("primary");
    expect(isBotInstallTarget("TTEAM123")).toBe(true);
    expect(isBotInstallTarget("../evil")).toBe(false);
    expect(isBotInstallTarget(null)).toBe(false);
  });

  it("restricts Slack's approval page to the primary team by default, to a named team, or to none for a new workspace", () => {
    expect(new URL(buildBotInstallUrl("bot.primary.x")).searchParams.get("team")).toBe("T_PRIMARY");
    expect(new URL(buildBotInstallUrl("bot.T2.x", "T_SECOND")).searchParams.get("team")).toBe("T_SECOND");
    expect(new URL(buildBotInstallUrl("bot.new.x", null)).searchParams.has("team")).toBe(false);
  });
});

describe("completeBotInstall into another workspace", () => {
  useFakeClock(() => NOW);

  it("registers a new workspace and stores its token under it, not the primary's", async () => {
    access.mockResolvedValue(granted({ id: "T_SECOND", name: "Shared program" }));
    const result = await completeBotInstall(service, "code-1", "new");

    const registered = dataset.slackWorkspaces.find((w) => w.team_id === "T_SECOND");
    expect(registered).toMatchObject({ name: "Shared program", is_primary: false });
    expect(result).toMatchObject({ ok: true, workspaceName: "Shared program" });
    expect(rpc).toHaveBeenCalledWith("slack_workspace_token_save", expect.objectContaining({ p_workspace_id: registered!.id, p_access_token: "xoxe.xoxb-new" }));
    expect(rpc).not.toHaveBeenCalledWith("slack_bot_token_save", expect.anything());
  });

  it("installing a new workspace that is already registered refreshes it instead of adding a second row", async () => {
    access.mockResolvedValue(granted({ id: "T_SECOND", name: "Shared program" }));
    await completeBotInstall(service, "code-1", "new");
    access.mockResolvedValue(granted({ id: "T_SECOND", name: "Shared program, renamed" }));
    await completeBotInstall(service, "code-2", "new");
    expect(dataset.slackWorkspaces.filter((w) => w.team_id === "T_SECOND")).toHaveLength(1);
    expect(dataset.slackWorkspaces.find((w) => w.team_id === "T_SECOND")?.name).toBe("Shared program, renamed");
  });

  it("reinstalls into a registered workspace by its team id, and refuses a different team or an unregistered one", async () => {
    dataset.slackWorkspaces.push({ id: "slws_AAAAAAAAAAA2", team_id: "T_SECOND", name: "Second", url: null, is_primary: false, created_at: "2026-01-01T00:00:00Z", deleted_at: null });

    access.mockResolvedValue(granted({ id: "T_SECOND", name: "Second" }));
    await expect(completeBotInstall(service, "code-1", "T_SECOND")).resolves.toMatchObject({ ok: true });
    expect(rpc).toHaveBeenCalledWith("slack_workspace_token_save", expect.objectContaining({ p_workspace_id: "slws_AAAAAAAAAAA2" }));

    rpc.mockClear();
    // Approved in a team the Hub has never seen, for an install that named another.
    access.mockResolvedValue(granted({ id: "T_STRANGER", name: "Stranger" }));
    await expect(completeBotInstall(service, "code-1", "T_OTHER")).resolves.toEqual({ ok: false, reason: "unknown_workspace" });
    // Approved in a registered team that is not the one the install named.
    access.mockResolvedValue(granted({ id: "T_SECOND", name: "Second" }));
    await expect(completeBotInstall(service, "code-1", "T_OTHER")).resolves.toEqual({ ok: false, reason: "wrong_workspace" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not hold a non-primary install to SLACK_TEAM_ID, and says Slack failed when the grant names no team", async () => {
    access.mockResolvedValue({ ...granted({ id: "T_SECOND", name: "Second" }) });
    await expect(completeBotInstall(service, "code-1", "new")).resolves.toMatchObject({ ok: true });
    access.mockResolvedValue({ ok: true, access_token: "x", refresh_token: "y", expires_in: 100 });
    await expect(completeBotInstall(service, "code-1", "new")).resolves.toEqual({ ok: false, reason: "slack" });
  });
});
