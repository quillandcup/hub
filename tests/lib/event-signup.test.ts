import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { checkoutUrlOf, eventSignups, spotsLabel } from "@/lib/event-signup";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const EVENT = "evt_AAAAAAAAAAA1";
const OTHER = "evt_AAAAAAAAAAA2";
const FULL = "offer_full";
const DEPOSIT = "offer_deposit";
const CHECKOUT = "https://checkout.example.com/offers/full";

const purchase = (id: string, customer: string, offer: string, extra: Record<string, unknown> = {}) => ({
  kajabi_purchase_id: id,
  kajabi_customer_id: customer,
  kajabi_offer_id: offer,
  amount_in_cents: 5000,
  created_at_kajabi: "2097-01-10T12:00:00Z",
  deactivated_at: null,
  ...extra,
});

function repos(over: Record<string, unknown> = {}) {
  return createInMemoryRepos(
    new InMemoryDataset({
      ...eventSeed([
        { id: EVENT, title: "Summer Retreat", slug: "summer-retreat" },
        { id: OTHER, title: "Winter Retreat", slug: "winter-retreat" },
      ]),
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com" },
      ],
      kajabiOffers: [
        { kajabi_offer_id: FULL, name: "Summer Retreat", data: { attributes: { checkout_url: CHECKOUT } } },
        { kajabi_offer_id: DEPOSIT, name: "Summer Retreat deposit", data: { attributes: { checkout_url: "javascript:alert(1)" } } },
      ],
      kajabiCustomers: [
        { kajabi_customer_id: "c1", email: "ada@example.com" },
        { kajabi_customer_id: "c2", email: "bo@example.com" },
        { kajabi_customer_id: "c3", email: "stranger@example.com" },
      ],
      eventOffers: [
        { event_id: EVENT, kajabi_offer_id: DEPOSIT },
        { event_id: EVENT, kajabi_offer_id: FULL },
      ],
      ...over,
    } as never),
  );
}

describe("eventSignups", () => {
  it("is empty when no event has an offer linked, or none is asked about", async () => {
    expect((await eventSignups(repos(), [{ id: OTHER, capacity: 5 }])).size).toBe(0);
    expect((await eventSignups(repos(), [])).size).toBe(0);
  });

  it("counts each person once, whether an attendee, a buyer of several offers, or someone with no member", async () => {
    const r = repos({
      eventAttendees: [{ event_id: EVENT, member_id: "mbr_AAAAAAAAAAA1" }],
      kajabiPurchases: [purchase("p1", "c1", FULL), purchase("p2", "c1", DEPOSIT), purchase("p3", "c2", FULL), purchase("p4", "c3", FULL), purchase("p5", "c3", DEPOSIT)],
    });
    const signup = (await eventSignups(r, [{ id: EVENT, capacity: 5 }])).get(EVENT);
    expect(signup).toEqual({ checkoutUrl: CHECKOUT, spotsLeft: 2, soldOut: false });
  });

  it("is sold out when every place is taken, never below zero, and ignores deactivated purchases and other offers", async () => {
    const r = repos({
      kajabiPurchases: [purchase("p1", "c1", FULL), purchase("p2", "c2", FULL), purchase("p3", "c3", FULL, { deactivated_at: "2097-02-01T00:00:00Z" }), purchase("p4", "c3", "offer_other")],
    });
    expect((await eventSignups(r, [{ id: EVENT, capacity: 2 }])).get(EVENT)).toMatchObject({ spotsLeft: 0, soldOut: true });
    expect((await eventSignups(r, [{ id: EVENT, capacity: 1 }])).get(EVENT)).toMatchObject({ spotsLeft: 0, soldOut: true });
    expect((await eventSignups(r, [{ id: EVENT, capacity: 3 }])).get(EVENT)).toMatchObject({ spotsLeft: 1, soldOut: false });
  });

  it("has no count for an event with no limit, but still gives the link", async () => {
    expect((await eventSignups(repos(), [{ id: EVENT, capacity: null }])).get(EVENT)).toEqual({ checkoutUrl: CHECKOUT, spotsLeft: null, soldOut: false });
  });

  it("passes on no link when the offers have none that is a web address", async () => {
    const r = repos({ eventOffers: [{ event_id: EVENT, kajabi_offer_id: DEPOSIT }] });
    expect((await eventSignups(r, [{ id: EVENT, capacity: null }])).get(EVENT)?.checkoutUrl).toBeNull();
  });
});

describe("checkoutUrlOf", () => {
  it("reads an http(s) link from the offer's record and nothing else", () => {
    expect(checkoutUrlOf({ attributes: { checkout_url: "http://a.example/x" } })).toBe("http://a.example/x");
    expect(checkoutUrlOf({ attributes: { checkout_url: "ftp://a.example" } })).toBeNull();
    expect(checkoutUrlOf({ attributes: {} })).toBeNull();
    expect(checkoutUrlOf(null)).toBeNull();
  });
});

describe("spotsLabel", () => {
  it("says sold out, or how many places are left", () => {
    expect(spotsLabel({ spotsLeft: 0, soldOut: true })).toBe("Sold out!");
    expect(spotsLabel({ spotsLeft: 1, soldOut: false })).toBe("1 place left");
    expect(spotsLabel({ spotsLeft: 4, soldOut: false })).toBe("4 places left");
    expect(spotsLabel({ spotsLeft: null, soldOut: false })).toBeNull();
    expect(spotsLabel(null)).toBeNull();
  });
});
