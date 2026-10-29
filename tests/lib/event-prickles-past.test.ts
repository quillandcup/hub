import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { monthOf } from "@/lib/events-agenda";

// The past side of the Events page: the prickles of listed types that started in a month and have ended.

const LISTED = { id: "ptyp_AAAAAAAAAAA1", name: "Pitch Prickle", normalizedName: "pitch", purpose: "work", requiresHost: false, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const EVERYDAY = { ...LISTED, id: "ptyp_AAAAAAAAAAA2", name: "Sprint", normalizedName: "sprint", listedInEvents: false };
const prickle = (id: string, typeId: string, start: string, end: string, calendarEventId: string | null = null) => ({
  id, typeId, hostId: null, title: null, startTime: start, endTime: end, source: "calendar", calendarEventId,
});

const dataset = new InMemoryDataset({
  prickleTypes: [LISTED, EVERYDAY],
  prickles: [
    prickle("prkl_AAAAAAAAAAA1", LISTED.id, "2026-10-09T18:00:00Z", "2026-10-09T19:00:00Z"),
    prickle("prkl_AAAAAAAAAAA2", EVERYDAY.id, "2026-10-09T18:00:00Z", "2026-10-09T19:00:00Z"), // not a listed type
    prickle("prkl_AAAAAAAAAAA3", LISTED.id, "2026-09-30T18:00:00Z", "2026-09-30T19:00:00Z"), // September
    prickle("prkl_AAAAAAAAAAA4", LISTED.id, "2026-10-01T02:00:00Z", "2026-10-01T03:00:00Z", "cal-1"), // 10pm Sep 30 in New York, Oct 1 in UTC
    prickle("prkl_AAAAAAAAAAA5", LISTED.id, "2026-10-20T18:00:00Z", "2026-10-20T19:00:00Z"), // not over yet
    prickle("prkl_AAAAAAAAAAA6", LISTED.id, "2026-10-31T23:30:00Z", "2026-11-01T00:30:00Z"), // starts Oct 31, ends Nov 1: not over yet either
  ],
});
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { fetchPastEventPrickles } from "@/lib/event-prickles";

const NOW = new Date("2026-10-15T12:00:00Z");
const october = monthOf("2026-10-01");
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe("fetchPastEventPrickles", () => {
  it("returns the listed prickles that started in the month and have ended, oldest first, leaving out other types, other months and what has not ended", async () => {
    expect(ids(await fetchPastEventPrickles({} as never, october, "UTC", NOW))).toEqual(["prkl_AAAAAAAAAAA4", "prkl_AAAAAAAAAAA1"]);
  });

  it("reads the month in the viewer's zone, so a session late on the 30th is September for someone in New York", async () => {
    expect(ids(await fetchPastEventPrickles({} as never, october, "America/New_York", NOW))).toEqual(["prkl_AAAAAAAAAAA1"]);
    expect(ids(await fetchPastEventPrickles({} as never, monthOf("2026-09-01"), "America/New_York", NOW))).toEqual(["prkl_AAAAAAAAAAA3", "prkl_AAAAAAAAAAA4"]);
  });

  it("carries the calendar item an event may follow, and the type's name", async () => {
    const [first] = await fetchPastEventPrickles({} as never, october, "UTC", NOW);
    expect(first).toMatchObject({ calendarEventId: "cal-1", typeName: "Pitch Prickle" });
  });

  it("is empty for a month with none", async () => {
    expect(await fetchPastEventPrickles({} as never, monthOf("2026-05-01"), "UTC", NOW)).toEqual([]);
  });
});
