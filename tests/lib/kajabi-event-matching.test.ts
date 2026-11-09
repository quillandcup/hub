import { describe, expect, it } from "vitest";
import { InMemoryDataset } from "@/lib/data/in-memory";
import { createInMemoryRepos } from "@/lib/data/repos";
import { findKajabiMatchesForEvent } from "@/lib/kajabi-event-matching";
import { eventSeed } from "@/tests/helpers/event-fixtures";

const EVENT = "evt_AAAAAAAAAAA1";
const FULL = "offer_full";
const DEPOSIT = "offer_deposit";

const purchase = (id: string, customer: string | null, offer: string, extra: Record<string, unknown> = {}) => ({
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
      ...eventSeed([{ id: EVENT, title: "Summer Retreat", slug: "summer-retreat" }]),
      members: [
        { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", displayName: "Ada E", email: "ada@example.com" },
        { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com" },
        { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.com" },
        { id: "mbr_AAAAAAAAAAA4", name: "Di Example", email: "di@example.com" },
      ],
      kajabiOffers: [
        { kajabi_offer_id: FULL, name: "Summer Retreat" },
        { kajabi_offer_id: DEPOSIT, name: "Summer Retreat deposit" },
        { kajabi_offer_id: "offer_other", name: "Something else" },
      ],
      kajabiCustomers: [
        { kajabi_customer_id: "c1", email: "ada@example.com" },
        { kajabi_customer_id: "c2", email: "BO@example.com" },
        { kajabi_customer_id: "c3", email: "cy.old@example.com" },
        { kajabi_customer_id: "c4", email: "stranger@example.com" },
      ],
      emailAliases: [{ id: "al1", memberId: "mbr_AAAAAAAAAAA3", active: true, alias_email: "cy.old@example.com", canonical_email: "cy@example.com" }],
      eventOffers: [
        { event_id: EVENT, kajabi_offer_id: FULL },
        { event_id: EVENT, kajabi_offer_id: DEPOSIT },
      ],
      ...over,
    } as never),
  );
}

describe("findKajabiMatchesForEvent", () => {
  it("says so when no offer is linked", async () => {
    const result = await findKajabiMatchesForEvent(repos({ eventOffers: [] }), EVENT);
    expect(result).toEqual({ offersLinked: false, buyers: [], unmatched: [], attendeesWithoutTicket: [] });
  });

  it("lists buyers of the linked offers who are not attendees, by display name, through email aliases", async () => {
    const r = repos({
      kajabiPurchases: [
        purchase("p1", "c1", FULL),
        purchase("p2", "c2", FULL, { created_at_kajabi: "2097-01-05T12:00:00Z" }),
        purchase("p3", "c3", DEPOSIT, { amount_in_cents: 2500 }),
        purchase("p4", "c1", "offer_other"),
      ],
    });

    const { offersLinked, buyers } = await findKajabiMatchesForEvent(r, EVENT);

    expect(offersLinked).toBe(true);
    // Oldest purchase first; the unlinked offer is ignored; Ada shows by display name with her legal name beside it.
    expect(buyers.map((b) => [b.member_name, b.member_real_name, b.offer_names, b.amount_in_cents, b.deactivated])).toEqual([
      ["Bo Example", null, ["Summer Retreat"], 5000, false],
      ["Ada E", "Ada Example", ["Summer Retreat"], 5000, false],
      ["Cy Example", null, ["Summer Retreat deposit"], 2500, false],
    ]);
  });

  it("combines several purchases of one buyer and flags one whose purchases were all deactivated", async () => {
    const r = repos({
      kajabiPurchases: [
        purchase("p1", "c1", DEPOSIT, { amount_in_cents: 2000 }),
        purchase("p2", "c1", FULL, { amount_in_cents: 3000 }),
        purchase("p3", "c2", FULL, { deactivated_at: "2097-02-01T00:00:00Z" }),
      ],
    });

    const { buyers } = await findKajabiMatchesForEvent(r, EVENT);

    const ada = buyers.find((b) => b.member_id === "mbr_AAAAAAAAAAA1")!;
    expect(ada).toMatchObject({ purchase_count: 2, amount_in_cents: 5000, deactivated: false });
    expect(ada.offer_names.sort()).toEqual(["Summer Retreat", "Summer Retreat deposit"]);
    expect(buyers.find((b) => b.member_id === "mbr_AAAAAAAAAAA2")!.deactivated).toBe(true);
  });

  it("leaves out buyers who are already attendees", async () => {
    const r = repos({
      kajabiPurchases: [purchase("p1", "c1", FULL), purchase("p2", "c2", FULL)],
      eventAttendees: [{ id: "a1", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA1", ticket_source: "purchased" }],
    });

    const { buyers } = await findKajabiMatchesForEvent(r, EVENT);

    expect(buyers.map((b) => b.member_id)).toEqual(["mbr_AAAAAAAAAAA2"]);
  });

  it("lists a purchase whose buyer has no member instead of skipping it", async () => {
    const r = repos({ kajabiPurchases: [purchase("p1", "c4", FULL), purchase("p2", null, FULL)] });

    const { buyers, unmatched } = await findKajabiMatchesForEvent(r, EVENT);

    expect(buyers).toEqual([]);
    expect(unmatched.map((u) => u.email).sort()).toEqual(["(no email on the Kajabi customer)", "stranger@example.com"]);
    expect(unmatched[0].offer_names).toEqual(["Summer Retreat"]);
  });

  it("lists attendees with no purchase and no recorded reason, but not comped, gifted or donated ones", async () => {
    const r = repos({
      kajabiPurchases: [purchase("p1", "c1", FULL)],
      eventAttendees: [
        { id: "a1", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA1", ticket_source: "purchased" },
        { id: "a2", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA2", ticket_source: null },
        { id: "a3", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA3", ticket_source: "comped" },
        { id: "a4", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA4", ticket_source: "purchased" },
      ],
    });

    const { attendeesWithoutTicket } = await findKajabiMatchesForEvent(r, EVENT);

    // Ada bought; Cy is comped; Bo has nothing recorded; Di says purchased but has no purchase.
    expect(attendeesWithoutTicket.map((a) => [a.member_name, a.ticket_source])).toEqual([
      ["Bo Example", null],
      ["Di Example", "purchased"],
    ]);
  });
});
