import { InMemoryDataset } from "@/lib/data/in-memory";
import { InMemoryCalendarFeedRepository } from "@/lib/data/calendar-feed";
import type { Prickle, PrickleType } from "@/lib/data/prickles";
import { defineCalendarFeedContract } from "@/tests/helpers/calendar-feed-contract";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const members: [string, string] = ["mbr_AAAAAAAAAAA1", "mbr_AAAAAAAAAAA2"];
const type = (n: number, name: string): PrickleType => ({
  id: `ptyp_AAAAAAAAAAA${n}`,
  name,
  normalizedName: name.toLowerCase().replace(/\s+/g, "-"),
  purpose: "writing",
  requiresHost: false,
  soloTaskFriendly: false,
  listedInEvents: false,
  announcedPublicly: false,
  guestsAllowed: false,
});
const types = [type(1, "Sprint Writing"), type(2, "Progress Prickle")] as const;
const prickle = (n: number, typeId: string): Prickle => ({
  id: `prkl_AAAAAAAAAAA${n}`,
  typeId,
  hostId: null,
  title: null,
  startTime: new Date(Date.UTC(2097, 0, 1, 9 + n)).toISOString(),
  endTime: new Date(Date.UTC(2097, 0, 1, 10 + n)).toISOString(),
  source: "calendar",
  calendarEventId: null,
});
const prickles = [prickle(1, types[0].id), prickle(2, types[1].id)] as const;
const events = [
  { id: "evnt_AAAAAAAAAAA1", slug: "retreat", title: "Spring Retreat", starts_at: "2097-04-10", ends_at: "2097-04-12" },
  { id: "evnt_AAAAAAAAAAA2", slug: "workshop", title: "Autumn Workshop", starts_at: "2097-10-01", ends_at: "2097-10-01" },
] as const;
const seededEvents = eventSeed(events.map((e) => ({ ...e })));
const eventContext = (e: (typeof events)[number]) => ({ id: e.id, title: e.title, startsAt: e.starts_at, endsAt: e.ends_at });

defineCalendarFeedContract("InMemoryCalendarFeedRepository", () => {
  const dataset = new InMemoryDataset({
    members: members.map((id, i) => ({ id, name: `Member ${i + 1} Example` })),
    prickleTypes: [...types],
    prickles: [...prickles, ...seededEvents.prickles],
    events: seededEvents.events,
  });
  return {
    repo: () => new InMemoryCalendarFeedRepository(dataset),
    members,
    types: [
      { id: types[0].id, name: types[0].name },
      { id: types[1].id, name: types[1].name },
    ],
    prickles: [
      { id: prickles[0].id, typeId: types[0].id, startTime: prickles[0].startTime },
      { id: prickles[1].id, typeId: types[1].id, startTime: prickles[1].startTime },
    ],
    events: [eventContext(events[0]), eventContext(events[1])],
    reset: async () => {
      dataset.calendarFeedItems = [];
      dataset.calendarFeedTokens = [];
    },
  };
});
