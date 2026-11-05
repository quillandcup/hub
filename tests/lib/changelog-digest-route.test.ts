import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";
import { CHANGELOG_ENTRIES } from "@/lib/changelog/entries";
import { listProductChangelog } from "@/lib/changelog";

// The weekly route on the in-memory repositories, with auth, Slack and the heartbeat faked.
const requireAdmin = vi.fn();
vi.mock("@/lib/supabase/api-auth", () => ({ requireAdmin: (r: unknown) => requireAdmin(r) }));
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/cron-heartbeats", () => ({ withCronHeartbeat: async (_job: string, res: Response) => res }));
const sendSlackDM = vi.fn(async (_p: unknown) => {});
const postToSlackChannel = vi.fn(async (_p: unknown) => true);
vi.mock("@/lib/slack", async () => ({
  ...(await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack")),
  sendSlackDM: (p: unknown) => sendSlackDM(p),
  postToSlackChannel: (p: unknown) => postToSlackChannel(p),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }));
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) => new Map(members.map((m) => [`U-${m.id}`, m.id])),
}));

let dataset: InMemoryDataset;
let repos: Repos;
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const { GET } = await import("@/app/api/internal/changelog-digest/route");
const { digestCandidates } = await import("@/lib/changelog/digest");

const request = () => new NextRequest("http://localhost/api/internal/changelog-digest");
const flag = (enabled: boolean) => ({ feature_key: "changelog_digest", enabled_globally: enabled, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z" });
const latest = listProductChangelog(CHANGELOG_ENTRIES)[0].date;

function setup(featureFlags: ReturnType<typeof flag>[]) {
  dataset = new InMemoryDataset({ members: [{ id: "m1", name: "Member One", firstJoinedAt: "2024-01-01", userId: null }], featureFlags });
  repos = createInMemoryRepos(dataset);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(console, "log").mockImplementation(() => {});
  sendSlackDM.mockClear();
  postToSlackChannel.mockClear();
  // Today, as far as the digest knows, is the day the newest entry shipped.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${latest}T16:00:00Z`));
  requireAdmin.mockResolvedValue({ user: { id: "cron" }, forbidden: false });
  setup([flag(false)]);
});

describe("GET /api/internal/changelog-digest", () => {
  it("refuses a visitor who is signed out, and one who is not an admin", async () => {
    requireAdmin.mockResolvedValueOnce({ user: null });
    expect((await GET(request())).status).toBe(401);
    requireAdmin.mockResolvedValueOnce({ user: { id: "u" }, forbidden: true });
    expect((await GET(request())).status).toBe(403);
    expect(sendSlackDM).not.toHaveBeenCalled();
  });

  it("only logs while the flag is off: nothing sent, posted or recorded", async () => {
    const body = await (await GET(request())).json();
    expect(body.members).toEqual({ sent: 0, dryRun: 1 });
    expect(body.channel.posted).toBe(0);
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(postToSlackChannel).not.toHaveBeenCalled();
    expect(dataset.notificationLog).toEqual([]);
  });

  it("sends to members and posts to the channel once the flag is on for everyone, and not twice", async () => {
    setup([flag(true)]);
    const body = await (await GET(request())).json();
    expect(body.members).toEqual({ sent: 1, dryRun: 0 });
    expect(body.channel.posted).toBe(digestCandidates(new Date(`${latest}T16:00:00Z`)).length);
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
    expect(postToSlackChannel).toHaveBeenCalledTimes(1);

    const again = await (await GET(request())).json();
    expect(again).toEqual({ members: { sent: 0, dryRun: 0 }, channel: { posted: 0, dryRun: 0 } });
    expect(sendSlackDM).toHaveBeenCalledTimes(1);
  });
});
