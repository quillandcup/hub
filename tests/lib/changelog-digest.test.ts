import { beforeEach, describe, expect, it, vi } from "vitest";
import { APP_URL } from "@/lib/config";
import type { ChangelogEntry } from "@/lib/changelog/entries";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos, type Repos } from "@/lib/data/repos";

// The digest end to end on the in-memory repositories, with Slack faked: what matters is who is sent which entries,
// that nothing is sent twice, and that a dry run sends and records nothing.
const sendSlackDM = vi.fn(async (_params: { slackUserId: string; text: string; blocks?: any[] }) => {});
const postToSlackChannel = vi.fn(async (_params: { channel: string; text: string; blocks?: any[] }) => true);
vi.mock("@/lib/slack", async () => ({
  ...(await vi.importActual<typeof import("@/lib/slack")>("@/lib/slack")),
  sendSlackDM: (p: any) => sendSlackDM(p),
  postToSlackChannel: (p: any) => postToSlackChannel(p),
}));
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => {}) }));
// The window logic is under test here, not the real start day (app.config.ts changelogDigestStartsOn), so move it far back.
vi.mock("@/lib/config", async () => ({ ...(await vi.importActual<typeof import("@/lib/config")>("@/lib/config")), CHANGELOG_DIGEST_STARTS_ON: "2026-01-01" }));
// The in-app channel builds its own repositories over the service-role client: the same in-memory ones here.
vi.mock("@/lib/supabase/service", () => ({ createServiceRoleClient: () => ({}) }));
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

const notInSlack = new Set<string>();
vi.mock("@/lib/slack-matching", () => ({
  matchSlackUsersToMembers: (_slack: unknown, members: { id: string }[]) =>
    new Map(members.filter((m) => !notInSlack.has(m.id)).map((m) => [`U-${m.id}`, m.id])),
}));

const { CHANGELOG_DIGEST_KIND, channelPost, digestCandidates, digestMessage, postChangelogToChannel, rankByBenefit, sendChangelogDigest, worthSending } = await import("@/lib/changelog/digest");

const NOW = new Date("2026-11-10T14:00:00Z");

const entry = (over: Partial<ChangelogEntry>): ChangelogEntry => ({
  slug: "a-thing",
  date: "2026-11-05",
  audience: "product",
  category: "new",
  title: "A thing",
  summary: "It does a thing.",
  body: "More.",
  ...over,
});
const first = entry({ slug: "first", date: "2026-11-03", title: "First", summary: "The first one." });
const second = entry({ slug: "second", date: "2026-11-08", title: "Second & <more>", summary: "The second one.", image: { src: "/changelog/second/shot.png", alt: "The page" } });

let dataset: InMemoryDataset;
let repos: Repos;
const member = (id: string) => ({ id, name: `Member ${id}`, firstJoinedAt: "2024-01-01", userId: null });

function setup(seed: ConstructorParameters<typeof InMemoryDataset>[0] = {}) {
  dataset = new InMemoryDataset({ members: [member("m1"), member("m2")], ...seed });
  repos = createInMemoryRepos(dataset);
}

beforeEach(() => {
  sendSlackDM.mockClear();
  postToSlackChannel.mockClear();
  postToSlackChannel.mockResolvedValue(true);
  notInSlack.clear();
  vi.restoreAllMocks();
  setup();
});

describe("digestCandidates", () => {
  it("keeps entries from the last 30 days, newest first", () => {
    const old = entry({ slug: "old", date: "2026-10-01" });
    expect(digestCandidates(NOW, [old, first, second]).map((e) => e.slug)).toEqual(["second", "first"]);
    expect(digestCandidates(new Date("2026-12-04T14:00:00Z"), [first, second]).map((e) => e.slug)).toEqual(["second"]);
  });
});

describe("digestCandidates: who and what is never notified", () => {
  it("leaves out engineering entries, which are for staff only", () => {
    const eng = entry({ slug: "eng", date: "2026-11-09", audience: "engineering" });
    expect(digestCandidates(NOW, [first, eng]).map((e) => e.slug)).toEqual(["first"]);
  });

  it("leaves out staff entries, which are for the admin Changelog only", () => {
    const staff = entry({ slug: "staff", date: "2026-11-09", audience: "staff" });
    expect(digestCandidates(NOW, [first, staff]).map((e) => e.slug)).toEqual(["first"]);
  });

  it("never reaches before the configured start day, so backfilled history is not sent", () => {
    const history = entry({ slug: "history", date: "2026-10-20" });
    // Inside the 30-day window, but before the start day.
    expect(digestCandidates(NOW, [history, first, second], "2026-11-04").map((e) => e.slug)).toEqual(["second"]);
    expect(digestCandidates(NOW, [history, first, second], "2026-10-01").map((e) => e.slug)).toEqual(["second", "first", "history"]);
  });
});

describe("digestMessage", () => {
  it("reads as the entry itself when there is one, linking to it", () => {
    const m = digestMessage([first]);
    expect(m).toMatchObject({ title: "First", text: "The first one.", url: `${APP_URL}/changelog/first` });
    expect(JSON.stringify(m.slackBlocks)).toContain(`${APP_URL}/changelog/first|Read more`);
  });

  it("is a roundup with the list's link for several, escaping Slack text and showing screenshots", () => {
    const m = digestMessage([second, first]);
    expect(m.title).toBe("What's new in the Hub");
    expect(m.url).toBe(`${APP_URL}/changelog`);
    const blocks = JSON.stringify(m.slackBlocks);
    expect(blocks).toContain("Second &amp; &lt;more&gt;");
    expect(blocks).not.toContain("Second & <more>");
    expect(blocks).toContain(`${APP_URL}/changelog/second/shot.png`);
    expect(blocks).toContain("See what's new");
  });

  it("shows three, most valuable first (new, improved, fixed), and counts the rest", () => {
    const many = [
      entry({ slug: "fix-a", title: "FixA", category: "fixed", date: "2026-11-09" }),
      entry({ slug: "imp-a", title: "ImpA", category: "improved", date: "2026-11-08" }),
      entry({ slug: "new-a", title: "NewA", category: "new", date: "2026-11-07" }),
      entry({ slug: "new-b", title: "NewB", category: "new", date: "2026-11-06" }),
      entry({ slug: "fix-b", title: "FixB", category: "fixed", date: "2026-11-05" }),
    ];
    expect(rankByBenefit(many).map((e) => e.slug)).toEqual(["new-a", "new-b", "imp-a", "fix-a", "fix-b"]);
    const blocks = JSON.stringify(digestMessage(many).slackBlocks);
    for (const shown of ["NewA", "NewB", "ImpA"]) expect(blocks).toContain(shown);
    for (const hidden of ["FixA", "FixB"]) expect(blocks).not.toContain(hidden);
    expect(blocks).toContain("2 more on the What's new page");
  });

  it("puts a major entry first, whatever its date or category", () => {
    const entries = [
      entry({ slug: "new-recent", title: "NewRecent", category: "new", date: "2026-11-09" }),
      entry({ slug: "big-older", title: "BigOlder", category: "improved", major: true, date: "2026-11-05" }),
      entry({ slug: "fix", title: "Fix", category: "fixed", date: "2026-11-09" }),
    ];
    expect(rankByBenefit(entries).map((e) => e.slug)).toEqual(["big-older", "new-recent", "fix"]);
  });

  it("only sends when something is new or improved, not for a week of fixes alone", () => {
    expect(worthSending([entry({ category: "fixed" }), entry({ slug: "b", category: "fixed" })])).toBe(false);
    expect(worthSending([entry({ category: "fixed" }), entry({ slug: "b", category: "improved" })])).toBe(true);
    expect(worthSending([])).toBe(false);
  });
});

describe("sendChangelogDigest", () => {
  it("sends each member the entries they have not had, as one message, and claims them", async () => {
    expect(await sendChangelogDigest(repos, NOW, { entries: [first, second] })).toEqual({ sent: 2, dryRun: 0 });
    expect(sendSlackDM).toHaveBeenCalledTimes(2);
    expect(sendSlackDM.mock.calls[0][0].text).toContain("Second & <more>");
    expect(dataset.notificationLog.map((r) => [r.recipient, r.kind, r.dedupKey]).sort()).toEqual([
      ["m1", CHANGELOG_DIGEST_KIND, "first"],
      ["m1", CHANGELOG_DIGEST_KIND, "second"],
      ["m2", CHANGELOG_DIGEST_KIND, "first"],
      ["m2", CHANGELOG_DIGEST_KIND, "second"],
    ]);
  });

  it("sends nothing the second time, and only what is new the third", async () => {
    await sendChangelogDigest(repos, NOW, { entries: [first] });
    sendSlackDM.mockClear();
    expect(await sendChangelogDigest(repos, NOW, { entries: [first] })).toEqual({ sent: 0, dryRun: 0 });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(await sendChangelogDigest(repos, NOW, { entries: [first, second] })).toEqual({ sent: 2, dryRun: 0 });
    expect(sendSlackDM.mock.calls[0][0].text).toBe("The second one.");
  });

  it("does nothing when no entry is recent enough", async () => {
    expect(await sendChangelogDigest(repos, new Date("2027-03-01T14:00:00Z"), { entries: [first, second] })).toEqual({ sent: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("skips a member who opted out everywhere, without claiming, so turning it on later still sends", async () => {
    setup({
      members: [member("m1")],
      notificationPreferences: [
        { memberId: "m1", kind: "changelog_digest", channel: "slack", enabled: false },
        { memberId: "m1", kind: "changelog_digest", channel: "in_app", enabled: false },
      ],
    });
    expect(await sendChangelogDigest(repos, NOW, { entries: [first] })).toEqual({ sent: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("gives the claims back when the message reached no channel, so the next run tries again", async () => {
    sendSlackDM.mockRejectedValueOnce(new Error("slack down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ members: [member("m1")], notificationPreferences: [{ memberId: "m1", kind: "changelog_digest", channel: "in_app", enabled: false }] });
    expect(await sendChangelogDigest(repos, NOW, { entries: [first] })).toEqual({ sent: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
    expect(await sendChangelogDigest(repos, NOW, { entries: [first] })).toEqual({ sent: 1, dryRun: 0 });
  });

  it("only logs for members it is not live for, recording and sending nothing", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await sendChangelogDigest(repos, NOW, { entries: [first], liveFor: async () => new Set(["m2"]) });
    expect(result).toEqual({ sent: 1, dryRun: 1 });
    expect(sendSlackDM.mock.calls.map((c) => c[0].slackUserId)).toEqual(["U-m2"]);
    expect(dataset.notificationLog.map((r) => r.recipient)).toEqual(["m2"]);
    expect(log.mock.calls.some((c) => String(c[0]).includes("DRY RUN") && String(c[1]).includes('"memberId":"m1"'))).toBe(true);
  });

  it("sends nothing for a week of only fixes, and claims nothing, so they ride along with the next real entry", async () => {
    const fix = entry({ slug: "just-a-fix", category: "fixed", date: "2026-11-09" });
    expect(await sendChangelogDigest(repos, NOW, { entries: [fix] })).toEqual({ sent: 0, dryRun: 0 });
    expect(sendSlackDM).not.toHaveBeenCalled();
    expect(dataset.notificationLog).toEqual([]);
    // The next week brings something new: the fix goes with it.
    const next = entry({ slug: "a-real-one", category: "new", date: "2026-11-10" });
    expect(await sendChangelogDigest(repos, NOW, { entries: [fix, next] })).toEqual({ sent: 2, dryRun: 0 });
    expect(dataset.notificationLog.map((r) => r.dedupKey).sort()).toEqual(["a-real-one", "a-real-one", "just-a-fix", "just-a-fix"]);
  });

  it("does nothing without members", async () => {
    setup({ members: [] });
    expect(await sendChangelogDigest(repos, NOW, { entries: [first] })).toEqual({ sent: 0, dryRun: 0 });
  });
});

describe("postChangelogToChannel", () => {
  const options = { entries: [first, second], channelId: "C-ANN" } as const;

  it("posts the entries not yet in the channel and claims them under the channel", async () => {
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: true })).toEqual({ posted: 2, dryRun: 0 });
    expect(postToSlackChannel).toHaveBeenCalledTimes(1);
    expect(postToSlackChannel.mock.calls[0][0]).toMatchObject({ channel: "C-ANN", text: "What's new in the Hub" });
    expect(dataset.notificationLog.map((r) => [r.place, r.dedupKey]).sort()).toEqual([["slack:C-ANN", "first"], ["slack:C-ANN", "second"]]);
  });

  it("posts only what is new on the next run, and a single entry as itself", async () => {
    await postChangelogToChannel(repos, NOW, { ...options, entries: [first], live: true });
    postToSlackChannel.mockClear();
    expect(await postChangelogToChannel(repos, NOW, { ...options, entries: [first], live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: true })).toEqual({ posted: 1, dryRun: 0 });
    expect(postToSlackChannel.mock.calls[0][0].text).toBe("What's new in the Hub: Second & <more>");
    expect(channelPost([first]).text).toBe("What's new in the Hub: First");
  });

  it("only logs when it is not live", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: false })).toEqual({ posted: 0, dryRun: 2 });
    expect(postToSlackChannel).not.toHaveBeenCalled();
    expect(dataset.notificationLog).toEqual([]);
    expect(log.mock.calls.some((c) => String(c[0]).includes("DRY RUN channel post"))).toBe(true);
  });

  it("gives the claims back when Slack refuses or nothing was posted (test mode), so the next run tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    postToSlackChannel.mockRejectedValueOnce(new Error("channel_not_found"));
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
    postToSlackChannel.mockResolvedValueOnce(false);
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(dataset.notificationLog).toEqual([]);
  });

  it("posts nowhere without a channel", async () => {
    expect(await postChangelogToChannel(repos, NOW, { ...options, channelId: "", live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(postToSlackChannel).not.toHaveBeenCalled();
  });

  it("posts nothing for fixes alone", async () => {
    const fix = entry({ slug: "just-a-fix", category: "fixed", date: "2026-11-09" });
    expect(await postChangelogToChannel(repos, NOW, { entries: [fix], channelId: "C-ANN", live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(postToSlackChannel).not.toHaveBeenCalled();
  });

  it("does nothing when everything was posted", async () => {
    await postChangelogToChannel(repos, NOW, { ...options, live: true });
    postToSlackChannel.mockClear();
    expect(await postChangelogToChannel(repos, NOW, { ...options, live: true })).toEqual({ posted: 0, dryRun: 0 });
    expect(postToSlackChannel).not.toHaveBeenCalled();
  });
});
