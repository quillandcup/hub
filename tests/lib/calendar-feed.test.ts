import { describe, it, expect } from "vitest";
import {
  buildCalendarFeedEvents,
  calendarFeedUrls,
  parseFeedToken,
  prickleCalendarState,
  type MyCalendarItem,
  type CommittedOccurrence,
  type FeedPrickle,
} from "@/lib/calendar-feed";
import { APP_URL } from "@/lib/config";

const UID_DOMAIN = new URL(APP_URL).host;

const ORIGIN = "https://hub.quillandcup.com";
const TOKEN = "0123456789abcdef0123456789abcdef";

describe("calendarFeedUrls", () => {
  const urls = calendarFeedUrls(ORIGIN, TOKEN);

  it("builds the https and webcal feed URLs", () => {
    expect(urls.https).toBe(`${ORIGIN}/api/calendar/feed/${TOKEN}.ics`);
    expect(urls.webcal).toBe(`webcal://hub.quillandcup.com/api/calendar/feed/${TOKEN}.ics`);
  });

  it("builds a Google Calendar add-by-URL link from the webcal URL", () => {
    const google = new URL(urls.google);
    expect(google.origin).toBe("https://calendar.google.com");
    expect(google.searchParams.get("cid")).toBe(urls.webcal);
  });

  it("builds an Outlook add-from-web link from the https URL", () => {
    const outlook = new URL(urls.outlook);
    expect(outlook.origin + outlook.pathname).toBe("https://outlook.live.com/calendar/0/addfromweb");
    expect(outlook.searchParams.get("url")).toBe(urls.https);
    expect(outlook.searchParams.get("name")).toBe("My Prickles · Hedgie Hub");
  });

  it("keeps http for local dev", () => {
    expect(calendarFeedUrls("http://localhost:3000", TOKEN).webcal).toBe(
      `webcal://localhost:3000/api/calendar/feed/${TOKEN}.ics`
    );
  });
});

describe("parseFeedToken", () => {
  it("accepts a 32-hex token with or without .ics", () => {
    expect(parseFeedToken(`${TOKEN}.ics`)).toBe(TOKEN);
    expect(parseFeedToken(TOKEN)).toBe(TOKEN);
  });

  it("rejects anything else", () => {
    expect(parseFeedToken("nope.ics")).toBeNull();
    expect(parseFeedToken(`${TOKEN.toUpperCase()}.ics`)).toBeNull();
    expect(parseFeedToken(`${TOKEN}0.ics`)).toBeNull();
    expect(parseFeedToken(`${TOKEN}.ics.txt`)).toBeNull();
  });
});

describe("buildCalendarFeedEvents", () => {
  const prickle = (overrides: Partial<FeedPrickle> = {}): FeedPrickle => ({
    id: "p1",
    typeId: "type-progress",
    typeName: "Progress Prickle",
    hostName: "Jenn Parker",
    startTime: "2026-09-29T11:00:00.000Z",
    endTime: "2026-09-29T12:00:00.000Z",
    ...overrides,
  });
  const committed = (overrides: Partial<CommittedOccurrence> = {}): CommittedOccurrence => ({
    prickle: prickle(),
    typeId: "type-progress",
    typeName: "Progress Prickle",
    expectedStart: "2026-09-29T11:00:00.000Z",
    commitmentTitle: "Progress Prickle · every Tuesday · 7:00 AM EDT",
    ...overrides,
  });

  it("titles hosted prickles as hosting and links to the prickle", () => {
    const [event] = buildCalendarFeedEvents({ memberId: "m1", origin: ORIGIN, hosted: [prickle()], committed: [] });
    expect(event.summary).toBe("Hosting: Progress Prickle");
    expect(event.url).toBe(`${ORIGIN}/prickles/p1`);
    expect(event.start.toISOString()).toBe("2026-09-29T11:00:00.000Z");
    expect(event.end.toISOString()).toBe("2026-09-29T12:00:00.000Z");
    expect(event.reminderMinutes).toBe(15);
    expect(event.status).toBeUndefined();
  });

  it("titles committed prickles with the host and mentions the commitment", () => {
    const [event] = buildCalendarFeedEvents({ memberId: "m1", origin: ORIGIN, hosted: [], committed: [committed()] });
    expect(event.summary).toBe("Progress Prickle with Jenn P");
    expect(event.description).toContain("Part of your commitment: Progress Prickle · every Tuesday · 7:00 AM EDT");
  });

  it("shows a prickle that's both hosted and committed once, as hosting", () => {
    const events = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [prickle()],
      committed: [committed()],
    });
    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe("Hosting: Progress Prickle");
  });

  it("marks a committed occurrence with no scheduled prickle as tentative at the committed time", () => {
    const [event] = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [],
      committed: [committed({ prickle: null, expectedStart: "2026-10-06T11:00:00.000Z" })],
    });
    expect(event.status).toBe("TENTATIVE");
    expect(event.summary).toBe("Progress Prickle");
    expect(event.start.toISOString()).toBe("2026-10-06T11:00:00.000Z");
    expect(event.end.toISOString()).toBe("2026-10-06T12:00:00.000Z");
    expect(event.url).toBeUndefined();
  });

  it("keys a scheduled prickle's UID on its (stable) id, so a rescheduled prickle moves instead of duplicating", () => {
    const before = buildCalendarFeedEvents({ memberId: "m1", origin: ORIGIN, hosted: [prickle()], committed: [] });
    const moved = prickle({ startTime: "2026-09-29T13:00:00.000Z", endTime: "2026-09-29T14:00:00.000Z" });
    const after = buildCalendarFeedEvents({ memberId: "m1", origin: ORIGIN, hosted: [moved], committed: [] });
    expect(after[0].uid).toBe(before[0].uid);
    expect(before[0].uid).toBe(`prickle-p1.m1@${UID_DOMAIN}`);
  });

  it("keys an unscheduled committed occurrence on its slot type and expected time", () => {
    const [event] = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [],
      committed: [committed({ prickle: null })],
    });
    expect(event.uid).toBe(`unscheduled-type-progress-20260929T110000Z.m1@${UID_DOMAIN}`);
  });

  it("sorts events by start time", () => {
    const events = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [prickle({ id: "late", startTime: "2026-10-01T11:00:00.000Z", endTime: "2026-10-01T12:00:00.000Z" })],
      committed: [committed()],
    });
    expect(events.map((e) => e.start.toISOString())).toEqual(["2026-09-29T11:00:00.000Z", "2026-10-01T11:00:00.000Z"]);
  });

  it("titles added prickles like committed ones, and lets hosting or committing win a clash", () => {
    const added = prickle({ id: "added", startTime: "2026-10-02T23:00:00.000Z", endTime: "2026-10-03T00:00:00.000Z", typeId: "type-edu", typeName: "Educational Prickle" });
    const events = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [prickle()],
      committed: [],
      added: [prickle(), added], // p1 is hosted too
    });
    expect(events.map((e) => e.summary)).toEqual(["Hosting: Progress Prickle", "Educational Prickle with Jenn P"]);
    expect(events[1].description).toContain("Added from Hedgie Hub");
    expect(events[1].url).toBe(`${ORIGIN}/prickles/added`);
  });

  it("writes added events as all-day, through their last day, with location and page link", () => {
    const [event] = buildCalendarFeedEvents({
      memberId: "m1",
      origin: ORIGIN,
      hosted: [],
      committed: [],
      events: [
        { id: "e1", slug: "fall-retreat", title: "Fall Retreat", location: "Asheville, NC", startsAt: "2026-10-09", endsAt: "2026-10-11" },
      ],
    });
    expect(event.allDay).toBe(true);
    expect(event.start.toISOString()).toBe("2026-10-09T00:00:00.000Z");
    expect(event.end.toISOString()).toBe("2026-10-12T00:00:00.000Z"); // exclusive
    expect(event.location).toBe("Asheville, NC");
    expect(event.url).toBe(`${ORIGIN}/events/fall-retreat`);
    expect(event.uid).toBe(`event-e1.m1@${UID_DOMAIN}`);
  });
});

describe("prickleCalendarState", () => {
  const items: MyCalendarItem[] = [
    { id: "i1", kind: "prickle", label: "", prickleId: "p1" },
    { id: "i2", kind: "slot", label: "", slotKey: "t2|1|19:00|America/New_York" },
    { id: "i3", kind: "event", label: "", eventId: "e1" },
  ];

  it("finds a one-off item by prickle id", () => {
    expect(prickleCalendarState(items, "p1", null)).toEqual({
      onceItemId: "i1",
      weeklyItemId: null,
    });
  });

  it("finds a weekly item by slot key", () => {
    expect(
      prickleCalendarState(items, "p2", "t2|1|19:00|America/New_York")
    ).toEqual({ onceItemId: null, weeklyItemId: "i2" });
  });

  it("reports nothing for a prickle that isn't added", () => {
    expect(prickleCalendarState(items, "p3", "t1|1|19:00|America/New_York")).toEqual({
      onceItemId: null,
      weeklyItemId: null,
    });
  });
});
