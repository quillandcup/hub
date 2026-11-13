import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { hasWindow, orgDay, overlapMessage, parseWindow, parseWindowDay, purchaseCountsForEvent, windowsOverlap } from "@/lib/event-offer-window";
import { eventSignups } from "@/lib/event-signup";
import { findKajabiMatchesForEvent, purchasersOfEvent } from "@/lib/kajabi-event-matching";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const EVENT = "evt_AAAAAAAAAAA1";
const OTHER = "evt_AAAAAAAAAAA2";
const FULL = "offer_full";
const WIN = { event_id: EVENT, kajabi_offer_id: FULL, purchased_from: "2026-02-01", purchased_until: "2026-03-08" };

const purchase = (id: string, customer: string, extra: Record<string, unknown> = {}) => ({
  kajabi_purchase_id: id,
  kajabi_customer_id: customer,
  kajabi_offer_id: FULL,
  amount_in_cents: 5000,
  created_at_kajabi: "2026-02-10T12:00:00Z",
  deactivated_at: null,
  ...extra,
});
const bought = (when: string, customer: string) => purchase(`p-${customer}`, customer, { created_at_kajabi: when });

function repos(over: Record<string, unknown> = {}) {
  return createInMemoryRepos(
    new InMemoryDataset({
      ...eventSeed([
        { id: EVENT, title: "Summer Retreat", slug: "summer-retreat", capacity: 2 },
        { id: OTHER, title: "Winter Retreat", slug: "winter-retreat" },
      ]),
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.com", kajabiId: "k1" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com" },
        { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.com" },
      ],
      kajabiOffers: [{ kajabi_offer_id: FULL, name: "Retreat" }],
      kajabiCustomers: [
        { kajabi_customer_id: "c1", email: "ada@example.com" },
        { kajabi_customer_id: "c2", email: "bo@example.com" },
        { kajabi_customer_id: "c3", email: "cy@example.com" },
        { kajabi_customer_id: "c4", email: "stranger@example.com" },
      ],
      eventOffers: [WIN],
      ...over,
    } as never),
  );
}

const names = async (r: ReturnType<typeof repos>) => (await findKajabiMatchesForEvent(r, EVENT)).buyers.map((b) => b.member_name).sort();

describe("purchase window helpers", () => {
  it("finds the Eastern day of an instant on either side of midnight and of daylight saving changes", () => {
    expect(orgDay("2026-01-01T04:59:00Z")).toBe("2025-12-31");
    expect(orgDay("2026-01-01T05:01:00Z")).toBe("2026-01-01");
    expect(orgDay("2026-03-09T03:30:00Z")).toBe("2026-03-08");
    expect(orgDay("2026-03-09T04:30:00Z")).toBe("2026-03-09");
    expect(orgDay("2026-11-02T04:30:00Z")).toBe("2026-11-01");
    expect(orgDay("2026-11-02T05:30:00Z")).toBe("2026-11-02");
    expect(orgDay("nonsense")).toBeNull();
  });

  it("tells overlapping windows from separate ones, with null ends open", () => {
    const w = (purchased_from: string | null, purchased_until: string | null) => ({ purchased_from, purchased_until });
    expect(windowsOverlap(w(null, null), w(null, null))).toBe(true);
    expect(windowsOverlap(w("2026-01-01", "2026-01-31"), w("2026-01-31", null))).toBe(true);
    expect(windowsOverlap(w("2026-01-01", "2026-01-31"), w("2026-02-01", null))).toBe(false);
    expect(windowsOverlap(w(null, "2026-01-31"), w("2026-02-01", "2026-02-28"))).toBe(false);
    expect(windowsOverlap(w("2026-02-01", "2026-02-28"), w(null, "2026-01-31"))).toBe(false);
    expect(hasWindow(w(null, null))).toBe(false);
    expect(hasWindow(w(null, "2026-01-31"))).toBe(true);
  });

  it("matches a purchase to the link of its own offer", () => {
    const p = { kajabi_offer_id: FULL, created_at_kajabi: "2026-02-10T12:00:00Z" };
    expect(purchaseCountsForEvent(p, [WIN])).toBe(true);
    expect(purchaseCountsForEvent({ ...p, kajabi_offer_id: "other" }, [WIN])).toBe(false);
    expect(purchaseCountsForEvent({ ...p, created_at_kajabi: "2027-01-01T12:00:00Z" }, [WIN])).toBe(false);
  });

  it("reads days and windows from a request", () => {
    expect(parseWindowDay(undefined)).toBeNull();
    expect(parseWindowDay("")).toBeNull();
    expect(parseWindowDay("2026-02-01")).toBe("2026-02-01");
    expect(parseWindowDay("2026-02-30")).toBeUndefined();
    expect(parseWindowDay("Feb 1")).toBeUndefined();
    expect(parseWindowDay(5)).toBeUndefined();
    expect(parseWindow({ purchasedFrom: "2026-02-01" })).toEqual({ window: { purchased_from: "2026-02-01", purchased_until: null } });
    expect(parseWindow({ purchasedFrom: "2026-02-02", purchasedUntil: "2026-02-01" })).toHaveProperty("error");
    expect(parseWindow({ purchasedUntil: "bad" })).toHaveProperty("error");
    expect(overlapMessage()).toMatch(/overlapping days/);
  });
});

describe("a window on a linked offer", () => {
  it("ignores a purchase before or after it, both boundary days inclusive", async () => {
    const r = repos({
      kajabiPurchases: [
        bought("2026-01-31T12:00:00Z", "c1"),
        bought("2026-02-01T15:00:00Z", "c2"),
        bought("2026-03-08T15:00:00Z", "c3"),
        bought("2026-03-09T15:00:00Z", "c4"),
      ],
    });
    expect(await names(r)).toEqual(["Bo Example", "Cy Example"]);
    expect((await findKajabiMatchesForEvent(r, EVENT)).unmatched).toEqual([]);
  });

  it("counts a purchase by its Eastern day around midnight and the March change", async () => {
    const r = repos({
      kajabiPurchases: [
        bought("2026-03-09T03:30:00Z", "c1"), // 23:30 Eastern on the last day: in
        bought("2026-03-09T04:30:00Z", "c2"), // 00:30 Eastern the next day: out
        bought("2026-02-01T04:59:00Z", "c3"), // 23:59 Eastern the day before: out
        bought("2026-02-01T05:01:00Z", "c4"), // 00:01 Eastern on the first day: in
      ],
    });
    const result = await findKajabiMatchesForEvent(r, EVENT);
    expect(result.buyers.map((b) => b.member_name)).toEqual(["Ada E"]);
    expect(result.unmatched.map((u) => u.email)).toEqual(["stranger@example.com"]);
  });

  it("counts the November change by Eastern day", async () => {
    const r = repos({
      eventOffers: [{ ...WIN, purchased_from: "2026-11-01", purchased_until: "2026-11-01" }],
      kajabiPurchases: [bought("2026-11-02T04:30:00Z", "c1"), bought("2026-11-02T05:30:00Z", "c2"), bought("2026-11-01T03:30:00Z", "c3")],
    });
    expect(await names(r)).toEqual(["Ada E"]);
  });

  it("treats a missing end as no limit on that side and falls back to the access start date", async () => {
    const from = repos({
      eventOffers: [{ ...WIN, purchased_until: null }],
      kajabiPurchases: [bought("2025-12-01T12:00:00Z", "c1"), bought("2030-01-01T12:00:00Z", "c2"), purchase("p3", "c3", { created_at_kajabi: null, effective_start_at: "2026-06-01T12:00:00Z" })],
    });
    expect(await names(from)).toEqual(["Bo Example", "Cy Example"]);

    const until = repos({ eventOffers: [{ ...WIN, purchased_from: null }], kajabiPurchases: [bought("2025-12-01T12:00:00Z", "c1"), bought("2030-01-01T12:00:00Z", "c2")] });
    expect(await names(until)).toEqual(["Ada E"]);
  });

  it("can't place a purchase with no date inside a window, but counts it for an open link", async () => {
    const noDate = purchase("p1", "c1", { created_at_kajabi: null });
    expect(await names(repos({ kajabiPurchases: [noDate] }))).toEqual([]);
    expect(await names(repos({ eventOffers: [{ event_id: EVENT, kajabi_offer_id: FULL }], kajabiPurchases: [noDate] }))).toEqual(["Ada E"]);
  });

  it("derives Purchased the same way, keeping two events that share an offer apart", async () => {
    const r = repos({
      eventOffers: [WIN, { event_id: OTHER, kajabi_offer_id: FULL, purchased_from: "2026-03-09", purchased_until: null }],
      kajabiPurchases: [bought("2026-02-10T12:00:00Z", "c1"), bought("2026-04-10T12:00:00Z", "c2")],
    });
    expect([...(await purchasersOfEvent(r, EVENT))]).toEqual(["mbr_AAAAAAAAAAA1"]);
    expect([...(await purchasersOfEvent(r, OTHER))]).toEqual(["mbr_AAAAAAAAAAA2"]);
  });

  it("counts only purchases in the window against the event's places", async () => {
    const r = repos({ kajabiPurchases: [bought("2026-02-10T12:00:00Z", "c1"), bought("2027-02-10T12:00:00Z", "c2"), bought("2027-02-11T12:00:00Z", "c3")] });
    const signups = await eventSignups(r, [{ id: EVENT, capacity: 2 }]);
    expect(signups.get(EVENT)?.spotsLeft).toBe(1);
  });

  describe("offers held in Kajabi", () => {
    const attendee = (over: Record<string, unknown>) => repos({ eventAttendees: [{ id: "a1", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA1", ticket_source: null }], ...over });
    const state = async (r: ReturnType<typeof repos>) => (await findKajabiMatchesForEvent(r, EVENT, async () => [FULL])).attendeesWithoutTicket[0].kajabi_offer;

    it("is still answered for an offer with no window that sells only this event", async () => {
      expect(await state(attendee({ eventOffers: [{ event_id: EVENT, kajabi_offer_id: FULL }] }))).toBe("held");
    });

    it("is unknown for an offer with a window, since Kajabi gives no date for a grant", async () => {
      expect(await state(attendee({}))).toBe("unknown");
    });

    it("is unknown for an offer another event also sells", async () => {
      expect(await state(attendee({ eventOffers: [{ event_id: EVENT, kajabi_offer_id: FULL }, { event_id: OTHER, kajabi_offer_id: FULL, purchased_from: "2027-01-01" }] }))).toBe("unknown");
    });
  });
});

describe("linking one offer to two events (in memory)", () => {
  it("accepts separate windows, refuses overlapping ones and edits a window", async () => {
    const { events } = repos({ eventOffers: [] });
    expect(await events.linkOffer(EVENT, FULL, null, { purchased_until: "2026-03-08" })).toEqual({ linked: true });
    expect(await events.linkOffer(OTHER, FULL, null, { purchased_from: "2026-03-09" })).toEqual({ linked: true });
    expect(await events.linkOffer(OTHER, FULL, null)).toEqual({ linked: true }); // already linked: no-op
    expect(await events.setOfferWindow(OTHER, FULL, { purchased_from: "2026-03-01", purchased_until: null })).toEqual({ updated: false, reason: "overlap", eventId: EVENT });
    expect(await events.setOfferWindow(OTHER, "nope", { purchased_from: null, purchased_until: null })).toEqual({ updated: false, reason: "not_linked" });
    expect(await events.setOfferWindow(OTHER, FULL, { purchased_from: "2026-04-01", purchased_until: null })).toEqual({ updated: true });
    expect(await events.offersOf(OTHER)).toEqual([{ kajabi_offer_id: FULL, purchased_from: "2026-04-01", purchased_until: null }]);
    expect(await events.linkOffer("evt_AAAAAAAAAAA3", FULL, null, { purchased_from: "2026-03-01", purchased_until: "2026-03-31" })).toEqual({ linked: false, eventId: EVENT, reason: "overlap" });
  });
});
