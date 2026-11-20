import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { availabilityText, comingUpCards, comingUpKey, comingUpOptions, formatEventWhen, loadComingUp, SIGN_UP_LABEL, type ComingUpOptions } from "@/lib/landing/live-events";
import { COMING_UP_KIND_LABELS, COMING_UP_KIND_OPTIONS, kindLabel } from "@/lib/landing/live-kinds";
import { EVENT_TYPES } from "@/lib/events-filter";
import { eventSeed, type EventSpec } from "@/tests/helpers/event-fixtures";
import { useFakeClock } from "@/tests/helpers/fake-clock";

const NOW = Date.parse("2026-11-19T15:00:00Z");
const CHECKOUT = "https://checkout.example.com/offers/retreat";
const ALL: ComingUpOptions = { kinds: [], max: 4 };

const purchase = (id: string, customer: string, offer: string, extra: Record<string, unknown> = {}) => ({
  kajabi_purchase_id: id,
  kajabi_customer_id: customer,
  kajabi_offer_id: offer,
  amount_in_cents: 5000,
  created_at_kajabi: "2026-10-10T12:00:00Z",
  deactivated_at: null,
  ...extra,
});

/** Public events by default: announced, shown, one all-day. */
const spec = (id: string, over: Partial<EventSpec> = {}): EventSpec => ({ id, slug: id, title: id, announced_publicly: true, event_type: "workshop", starts_at: "2026-12-05", ends_at: "2026-12-05", ...over });

function repos(specs: EventSpec[], extra: Record<string, unknown> = {}) {
  return createInMemoryRepos(new InMemoryDataset({ ...eventSeed(specs), ...extra } as never));
}

describe("loadComingUp", () => {
  useFakeClock(() => NOW);
  const load = async (specs: EventSpec[], options: ComingUpOptions = ALL, extra: Record<string, unknown> = {}) => loadComingUp(repos(specs, extra), options, new Date(NOW));

  it("lists only events announced publicly, shown, and starting later, soonest first", async () => {
    const out = await load([
      spec("evt_later", { title: "Later Workshop", starts_at: "2027-01-20", ends_at: "2027-01-20" }),
      spec("evt_secret", { title: "Members Only", announced_publicly: false }),
      spec("evt_hidden", { title: "Hidden One", deleted_at: "2026-11-01T00:00:00Z" }),
      spec("evt_past", { title: "Already Over", starts_at: "2026-10-01", ends_at: "2026-10-01" }),
      spec("evt_started", { title: "Started Today", start_time: "2026-11-19T14:00:00Z", end_time: "2026-11-19T18:00:00Z" }),
      spec("evt_soon", { title: "Soon Workshop", starts_at: "2026-11-25", ends_at: "2026-11-25" }),
    ]);
    expect(out.events.map((e) => e.title)).toEqual(["Soon Workshop", "Later Workshop"]);
  });

  it("limits the list and narrows it to the chosen kinds before limiting", async () => {
    const specs = [
      spec("evt_a", { title: "A", event_type: "session", starts_at: "2026-11-20", ends_at: "2026-11-20" }),
      spec("evt_b", { title: "B", event_type: "session", starts_at: "2026-11-21", ends_at: "2026-11-21" }),
      spec("evt_c", { title: "C", event_type: "in_person_retreat", starts_at: "2026-12-10", ends_at: "2026-12-12" }),
      spec("evt_d", { title: "D", event_type: "virtual_retreat", starts_at: "2027-01-10", ends_at: "2027-01-10" }),
    ];
    // The snapshot reads a little past the limit (events that start while it is cached are replaced); the cards cut to the limit.
    const first = await load(specs, { kinds: [], max: 1 });
    expect(first.events.map((e) => e.title)).toEqual(["A", "B", "C"]);
    expect(comingUpCards(first, new Date(NOW), { kinds: [], max: 1 }).map((c) => c.title)).toEqual(["A"]);
    const retreats = await load(specs, { kinds: ["in_person_retreat", "virtual_retreat"], max: 4 });
    expect(retreats.events.map((e) => [e.kind, e.title])).toEqual([["Retreat", "C"], ["Virtual retreat", "D"]]);
  });

  it("titles are cleaned and carry no host or speaker the member page would add", async () => {
    const out = await load([spec("evt_t", { title: "Quill & Cup [Retreat] Prickle: Spring Retreat w/ Grace Example", speakers: "Ada Example" })]);
    expect(out.events[0].title).toBe("Spring Retreat");
    expect(JSON.stringify(out)).not.toMatch(/Ada Example|Grace Example/);
  });

  it("counts places left from attendees and active purchases, once per person, and links to checkout only while there is room", async () => {
    const extra = {
      kajabiOffers: [
        { kajabi_offer_id: "offer_r", name: "Retreat", data: { attributes: { checkout_url: CHECKOUT } } },
        { kajabi_offer_id: "offer_f", name: "Full retreat", data: { attributes: { checkout_url: "https://checkout.example.com/offers/full" } } },
        { kajabi_offer_id: "offer_x", name: "Unsafe", data: { attributes: { checkout_url: "javascript:alert(1)" } } },
      ],
      kajabiCustomers: ["c1", "c2", "c3", "c4"].map((id) => ({ kajabi_customer_id: id, email: `${id}@example.com` })),
      kajabiPurchases: [
        purchase("p1", "c1", "offer_r"),
        purchase("p2", "c2", "offer_r"),
        purchase("p2b", "c2", "offer_r"),
        purchase("p3", "c3", "offer_r", { deactivated_at: "2026-11-01T00:00:00Z" }),
        purchase("p4", "c1", "offer_f"),
        purchase("p5", "c2", "offer_f"),
        purchase("p6", "c4", "offer_f"),
      ],
      eventOffers: [
        { event_id: "evt_r", kajabi_offer_id: "offer_r" },
        { event_id: "evt_f", kajabi_offer_id: "offer_f" },
        { event_id: "evt_x", kajabi_offer_id: "offer_x" },
      ],
    };
    const out = await load(
      [
        spec("evt_r", { title: "Open Retreat", event_type: "in_person_retreat", capacity: 5, registration: "signup", starts_at: "2027-03-13", ends_at: "2027-03-15" }),
        spec("evt_f", { title: "Full Retreat", event_type: "in_person_retreat", capacity: 3, registration: "signup", starts_at: "2027-04-10", ends_at: "2027-04-12" }),
        spec("evt_n", { title: "No Limit", event_type: "virtual_retreat", registration: "signup", starts_at: "2027-05-01", ends_at: "2027-05-01" }),
        spec("evt_x", { title: "Odd Link", capacity: 4, registration: "signup", starts_at: "2027-06-01", ends_at: "2027-06-01" }),
        spec("evt_nooffer", { title: "No Offer", capacity: 4, starts_at: "2027-07-01", ends_at: "2027-07-01" }),
      ],
      ALL,
      extra,
    );
    const by = Object.fromEntries(out.events.map((e) => [e.title, e]));
    expect(by["Open Retreat"]).toMatchObject({ availability: "3 spots left", href: CHECKOUT, linkLabel: SIGN_UP_LABEL });
    expect(by["Full Retreat"]).toMatchObject({ availability: "Sold out", soldOut: true, href: "", linkLabel: "" });
    expect(by["Open Retreat"].soldOut).toBe(false);
    expect(by["No Limit"]).toMatchObject({ availability: "", href: "", linkLabel: "" });
    // An address that is not http(s) is never passed on; the places are still counted.
    expect(by["Odd Link"]).toMatchObject({ availability: "4 spots left", href: "", linkLabel: "" });
    // No linked offer: places can't be counted reliably, so nothing is said (the member Events page says nothing either).
    expect(by["No Offer"]).toMatchObject({ availability: "", href: "" });
  });

  it("never carries ids or counts of people", async () => {
    const out = await load([spec("evt_r", { title: "Retreat", capacity: 2, registration: "signup" })]);
    expect(Object.keys(out.events[0]).sort()).toEqual(["availability", "date", "href", "imageAssetId", "kind", "linkLabel", "soldOut", "startTime", "time", "title", "when"]);
    expect(JSON.stringify(out)).not.toContain("evt_r");
  });

  it("gives an empty list when nothing qualifies", async () => {
    expect(await load([spec("evt_secret", { announced_publicly: false })])).toEqual({ events: [] });
  });
});

describe("dates", () => {
  const when = async (over: Partial<EventSpec>, now = NOW) => {
    const [e] = await repos([spec("evt_w", over)]).events.upcomingAnnounced({ from: new Date(0).toISOString(), limit: 1 });
    return formatEventWhen(e, new Date(now));
  };

  it("writes dates only for an all-day event, a range for several days, and the year when it is not this one", async () => {
    expect(await when({ starts_at: "2026-12-05", ends_at: "2026-12-05" })).toBe("Dec 5");
    expect(await when({ starts_at: "2026-12-05", ends_at: "2026-12-07" })).toBe("Dec 5 to 7");
    expect(await when({ starts_at: "2026-12-30", ends_at: "2027-01-02" })).toBe("Dec 30, 2026 to Jan 2, 2027");
    expect(await when({ starts_at: "2027-03-30", ends_at: "2027-04-02" })).toBe("Mar 30 to Apr 2, 2027");
  });

  it("keeps an all-day range across the daylight saving change on the right Eastern days", async () => {
    // The clocks go forward on 14 March 2027: the 13th is 24 hours long, the 14th 23, and the range still reads 13 to 15.
    expect(await when({ starts_at: "2027-03-13", ends_at: "2027-03-15" })).toBe("Mar 13 to 15, 2027");
    // And back on 7 November 2027, a 25-hour day.
    expect(await when({ starts_at: "2027-11-06", ends_at: "2027-11-08" })).toBe("Nov 6 to 8, 2027");
  });

  it("names the zone only when a time is shown, and uses the Eastern day, not the UTC one", async () => {
    // 7:30 pm Eastern on 4 Feb is 00:30 UTC on 5 Feb.
    expect(await when({ start_time: "2027-02-05T00:30:00Z", end_time: "2027-02-05T01:30:00Z" })).toBe("Feb 4, 2027, 7:30 – 8:30 pm EST");
    // 11:30 pm to 1 am Eastern crosses Eastern midnight: two days, dates only.
    expect(await when({ start_time: "2027-02-05T04:30:00Z", end_time: "2027-02-05T06:00:00Z" })).toBe("Feb 4 to 5, 2027");
    expect(await when({ start_time: "2026-12-05T15:00:00Z", end_time: "2026-12-05T16:00:00Z" })).toBe("Dec 5, 10 – 11 am EST");
    // In summer the zone is daylight time.
    expect(await when({ start_time: "2027-07-10T23:00:00Z", end_time: "2027-07-11T00:00:00Z" })).toBe("Jul 10, 2027, 7 – 8 pm EDT");
  });
});

describe("availabilityText", () => {
  it("says spots left only when they are known", () => {
    expect(availabilityText(undefined)).toBe("");
    expect(availabilityText({ spotsLeft: null, soldOut: false })).toBe("");
    expect(availabilityText({ spotsLeft: 6, soldOut: false })).toBe("6 spots left");
    expect(availabilityText({ spotsLeft: 1, soldOut: false })).toBe("1 spot left");
    expect(availabilityText({ spotsLeft: 0, soldOut: true })).toBe("Sold out");
  });
});

describe("kinds and options", () => {
  it("has a plain label for every kind of event, and \"Event\" for one it does not know", () => {
    for (const type of EVENT_TYPES) expect(COMING_UP_KIND_LABELS[type], type).toBeTruthy();
    expect(COMING_UP_KIND_OPTIONS.map((o) => o.value)).toEqual([...EVENT_TYPES]);
    expect(kindLabel("in_person_retreat")).toBe("Retreat");
    expect(kindLabel("virtual_retreat")).toBe("Virtual retreat");
    expect(kindLabel("brand_new_kind")).toBe("Event");
  });

  it("makes the block's options safe: known kinds only, 1 to 4 cards", () => {
    expect(comingUpOptions({})).toEqual({ kinds: [], max: 4 });
    expect(comingUpOptions({ kinds: ["workshop", "workshop", "bogus", 7], max: 2 })).toEqual({ kinds: ["workshop"], max: 2 });
    expect(comingUpOptions({ max: 99 }).max).toBe(4);
    expect(comingUpOptions({ max: 0 }).max).toBe(1);
    expect(comingUpOptions({ max: "x" }).max).toBe(4);
    expect(comingUpKey(comingUpOptions({ kinds: ["workshop", "social"] }))).toBe(comingUpKey(comingUpOptions({ kinds: ["social", "workshop"] })));
  });

  it("drops events that have started since the snapshot was taken, and keeps to the limit", () => {
    const card = (title: string, startTime: string) => ({ kind: "Event", title, when: "", availability: "", linkLabel: "", href: "", date: "", time: "", soldOut: false, imageAssetId: "", startTime });
    const snapshot = { events: [card("Gone", "2026-11-19T14:59:00Z"), card("One", "2026-11-20T00:00:00Z"), card("Two", "2026-11-21T00:00:00Z")] };
    expect(comingUpCards(snapshot, new Date(NOW), { kinds: [], max: 1 }).map((c) => c.title)).toEqual(["One"]);
  });
});
