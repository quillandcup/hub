import { eventSeed } from "@/tests/helpers/event-fixtures";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { MEMBER_IDENTITY, MEMBER_USER, authModule, resetServerPageMocks, signInAs, sudoModule, supabaseServerModule, useFakeSupabase } from "@/tests/helpers/server-page";

vi.mock("@/lib/auth", () => authModule);
vi.mock("@/lib/sudo", () => sudoModule);
vi.mock("@/lib/supabase/server", () => supabaseServerModule);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "hub.example.test", "x-forwarded-proto": "https" }) }));
vi.mock("@/lib/timezone", () => ({ getUserTimezonePreference: vi.fn(async () => "America/New_York") }));
let repos = createInMemoryRepos();
vi.mock("@/lib/data/repos", async () => ({
  ...(await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos")),
  createRepos: () => repos,
}));

import { getMyCalendarFeedUrls, getMyCalendarItems, regenerateMyCalendarFeedToken, removeMyCalendarItem } from "@/app/(member)/my-prickles/calendar-feed-actions";
import { refresh } from "next/cache";

const ME = MEMBER_IDENTITY.memberId;
const SPRINT = { id: "ptyp_AAAAAAAAAAA1", name: "Sprint", normalizedName: "sprint", purpose: "writing", requiresHost: false, soloTaskFriendly: false, listedInEvents: false, announcedPublicly: false, guestsAllowed: false };
const FUTURE = "2097-03-03T15:00:00Z";
const prickle = (id: string, startTime: string) => ({ id, typeId: SPRINT.id, hostId: null, title: null, startTime, endTime: startTime, source: "calendar", calendarEventId: null });
const tokenIn = (url: string) => /([0-9a-f]{32})/.exec(url)?.[1];

const seededEvents = eventSeed([
  { id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Retreat", starts_at: "2097-04-10", ends_at: "2097-04-12" },
  { id: "evnt_AAAAAAAAAAA2", slug: "old", title: "Old Retreat", starts_at: "2020-04-10", ends_at: "2020-04-12" },
]);

beforeEach(() => {
  resetServerPageMocks();
  signInAs(MEMBER_USER, MEMBER_IDENTITY);
  useFakeSupabase({});
  vi.mocked(refresh).mockClear();
  repos = createInMemoryRepos(
    new InMemoryDataset({
      prickleTypes: [SPRINT],
      prickles: [prickle("prkl_AAAAAAAAAAA1", FUTURE), prickle("prkl_AAAAAAAAAAA2", "2020-01-01T15:00:00Z"), ...seededEvents.prickles],
      events: seededEvents.events,
    }),
  );
});

describe("getMyCalendarFeedUrls", () => {
  it("creates the member's token on first use and hands back the same one afterwards", async () => {
    const first = await getMyCalendarFeedUrls();
    const second = await getMyCalendarFeedUrls();

    expect(first).not.toBeNull();
    expect(await repos.calendarFeed.tokenOf(ME)).toBe(tokenIn(JSON.stringify(first)));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(JSON.stringify(first)).toContain("hub.example.test");
  });

  it("is null for nobody signed in", async () => {
    signInAs(null);
    expect(await getMyCalendarFeedUrls()).toBeNull();
  });

  it("is null, and logs, when the token can't be read or stored", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "tokenOf").mockRejectedValueOnce(new Error("database is down"));
    expect(await getMyCalendarFeedUrls()).toBeNull();
    expect(log).toHaveBeenCalledWith("getMyCalendarFeedUrls: failed to load token", expect.any(Error));

    vi.spyOn(repos.calendarFeed, "createTokenIfMissing").mockRejectedValueOnce(new Error("database is down"));
    expect(await getMyCalendarFeedUrls()).toBeNull();
    expect(log).toHaveBeenCalledWith("getMyCalendarFeedUrls: failed to create token", expect.any(Error));

    vi.spyOn(repos.calendarFeed, "tokenOf").mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("database is down"));
    expect(await getMyCalendarFeedUrls()).toBeNull();
    log.mockRestore();
  });
});

describe("regenerateMyCalendarFeedToken", () => {
  it("replaces the token, so the old link stops working", async () => {
    const before = await getMyCalendarFeedUrls();
    const oldToken = tokenIn(JSON.stringify(before))!;

    const result = await regenerateMyCalendarFeedToken();

    expect("urls" in result).toBe(true);
    const newToken = await repos.calendarFeed.tokenOf(ME);
    expect(newToken).not.toBe(oldToken);
    expect(await repos.calendarFeed.ownerOfToken(oldToken)).toBeNull();
  });

  it("refuses when nobody is signed in, and says so when the database fails", async () => {
    const failed = { error: "Couldn't generate a new link. Please try again." };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "replaceToken").mockRejectedValueOnce(new Error("database is down"));
    expect(await regenerateMyCalendarFeedToken()).toEqual(failed);

    vi.spyOn(repos.calendarFeed, "tokenOf").mockResolvedValueOnce(null);
    expect(await regenerateMyCalendarFeedToken()).toEqual(failed);
    log.mockRestore();

    signInAs(null);
    expect(await regenerateMyCalendarFeedToken()).toEqual({ error: "Not signed in" });
  });
});

describe("getMyCalendarItems and removeMyCalendarItem", () => {
  it("lists what is still ahead, labelled, and drops what is over", async () => {
    const feed = repos.calendarFeed;
    await feed.addItem(ME, null, { kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA1" });
    await feed.addItem(ME, null, { kind: "prickle", prickle_id: "prkl_AAAAAAAAAAA2" }); // started already
    await feed.addItem(ME, null, { kind: "slot", type_id: SPRINT.id, day_of_week: 1, start_time_local: "07:00", timezone: "America/New_York" });
    await feed.addItem(ME, null, { kind: "event", event_id: "evnt_AAAAAAAAAAA1" });
    await feed.addItem(ME, null, { kind: "event", event_id: "evnt_AAAAAAAAAAA2" }); // over

    const items = await getMyCalendarItems();

    const label = (kind: string) => items.find((i) => i.kind === kind)?.label;
    expect(items).toHaveLength(3);
    expect(label("prickle")).toMatch(/^Sprint · /);
    expect(label("slot")).toContain("Sprint");
    expect(label("event")).toMatch(/^Retreat · /);
  });

  it("is empty for nobody signed in, and when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "listedItemsOf").mockRejectedValueOnce(new Error("database is down"));
    expect(await getMyCalendarItems()).toEqual([]);
    expect(log).toHaveBeenCalledWith("getMyCalendarItems: failed to load items", expect.any(Error));
    log.mockRestore();

    signInAs(null);
    expect(await getMyCalendarItems()).toEqual([]);
  });

  it("removes one of the member's items and refreshes the page", async () => {
    await repos.calendarFeed.addItem(ME, null, { kind: "event", event_id: "evnt_AAAAAAAAAAA1" });
    const [item] = await repos.calendarFeed.listedItemsOf(ME);

    expect(await removeMyCalendarItem(item.id)).toEqual({ ok: true });

    expect(await repos.calendarFeed.countItems(ME)).toBe(0);
    expect(refresh).toHaveBeenCalled();
  });

  it("refuses when nobody is signed in, and says so when the database fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(repos.calendarFeed, "removeItem").mockRejectedValueOnce(new Error("database is down"));
    expect(await removeMyCalendarItem("cfi_AAAAAAAAAAA1")).toEqual({ error: "Couldn't remove that. Please try again." });
    log.mockRestore();

    signInAs(null);
    expect(await removeMyCalendarItem("cfi_AAAAAAAAAAA1")).toEqual({ error: "Not signed in" });
  });
});
