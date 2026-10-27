import { describe, it, expect, vi } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";

// The Events page names each prickle's host by display name.

const NOW = new Date("2026-10-19T15:00:00Z");
const EVENT_TYPE = { id: "ptyp_AAAAAAAAAAA1", name: "Craft Talk", normalizedName: "craft talk", purpose: "educational", requiresHost: true, soloTaskFriendly: false, listedInEvents: true, announcedPublicly: false, guestsAllowed: false };
const prickle = (id: string, hostId: string | null, day: number) => ({
  id,
  typeId: EVENT_TYPE.id,
  hostId,
  title: null,
  startTime: new Date(NOW.getTime() + day * 86_400_000).toISOString(),
  endTime: new Date(NOW.getTime() + day * 86_400_000 + 3_600_000).toISOString(),
  source: "calendar",
  calendarEventId: null,
});

const dataset = new InMemoryDataset({
  members: [
    { id: "mbr_AAAAAAAAAAA1", name: "Laura May Best", displayName: "Bestie" },
    { id: "mbr_AAAAAAAAAAA2", name: "Ann Example", displayName: null },
  ],
  prickleTypes: [EVENT_TYPE],
  prickles: [prickle("prkl_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA1", 1), prickle("prkl_AAAAAAAAAAA2", "mbr_AAAAAAAAAAA2", 2), prickle("prkl_AAAAAAAAAAA3", null, 3)],
});
vi.mock("@/lib/data/repos", async () => {
  const actual = await vi.importActual<typeof import("@/lib/data/repos")>("@/lib/data/repos");
  return { ...actual, createRepos: () => actual.createInMemoryRepos(dataset) };
});

import { fetchUpcomingEventPrickles } from "@/lib/event-prickles";

describe("fetchUpcomingEventPrickles", () => {
  it("names hosts by display name, falling back to the legal name, or none", async () => {
    const events = await fetchUpcomingEventPrickles({} as never, NOW);

    expect(events.map((e) => e.hostName)).toEqual(["Bestie", "Ann Example", null]);
  });
});
