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
    expect(result).toEqual({ offersLinked: false, multiTicketBuyers: [], giftedAttendees: 0, buyers: [], unmatched: [], attendeesWithoutTicket: [] });
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

  it("lists attendees with no purchase and no recorded reason, but not comped or gifted ones", async () => {
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
  describe("the same person under two member records", () => {
    // The roster has one record (no ticket on record); the purchase belongs to the other.
    const twoRecords = (roster: { name: string; displayName?: string | null }) =>
      repos({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Erica Example", displayName: "Edy E", email: "ada@example.com" },
          { id: "mbr_AAAAAAAAAAA2", name: roster.name, displayName: roster.displayName ?? null, email: "bo@example.com", status: "lead" },
        ],
        kajabiPurchases: [purchase("p1", "c1", FULL)],
        eventAttendees: [{ id: "a1", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA2", ticket_source: null }],
      });

    it("points the buyer and the attendee at each other when their legal names match", async () => {
      const { buyers, attendeesWithoutTicket } = await findKajabiMatchesForEvent(twoRecords({ name: "Erica Example" }), EVENT);

      expect(buyers[0].possible_duplicate).toEqual({ member_id: "mbr_AAAAAAAAAAA2", member_name: "Erica Example" });
      expect(attendeesWithoutTicket[0].possible_duplicate).toEqual({ member_id: "mbr_AAAAAAAAAAA1", member_name: "Edy E" });
    });

    it("ignores case, accents and spacing, and matches a shown name too", async () => {
      expect((await findKajabiMatchesForEvent(twoRecords({ name: "  érica   EXAMPLE " }), EVENT)).buyers[0].possible_duplicate).not.toBeNull();
      expect((await findKajabiMatchesForEvent(twoRecords({ name: "Someone Else", displayName: "edy e" }), EVENT)).buyers[0].possible_duplicate).not.toBeNull();
    });

    it("says nothing when the names differ", async () => {
      const { buyers, attendeesWithoutTicket } = await findKajabiMatchesForEvent(twoRecords({ name: "Someone Else" }), EVENT);

      expect(buyers[0].possible_duplicate).toBeNull();
      expect(attendeesWithoutTicket[0].possible_duplicate).toBeNull();
    });
  });
  describe("buyers of more than one ticket", () => {
    it("lists each buyer of two or more active purchases of the same offer, attendee or not, most tickets first", async () => {
      const r = repos({
        kajabiPurchases: [
          purchase("p1", "c1", FULL),
          purchase("p2", "c1", FULL, { created_at_kajabi: "2097-01-08T12:00:00Z" }),
          purchase("p3", "c2", FULL),
          purchase("p4", "c2", FULL),
          purchase("p5", "c2", FULL),
          purchase("p6", "c4", FULL),
          purchase("p7", "c4", FULL),
          purchase("p8", "c3", FULL),
        ],
        eventAttendees: [
          { id: "a1", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA1", ticket_source: "purchased" },
          { id: "a2", event_id: EVENT, member_id: "mbr_AAAAAAAAAAA4", ticket_source: "gifted" },
        ],
      });

      const { multiTicketBuyers, giftedAttendees } = await findKajabiMatchesForEvent(r, EVENT);

      expect(multiTicketBuyers.map((b) => [b.name, b.tickets, b.is_attendee, b.first_bought?.slice(0, 10)])).toEqual([
        ["Bo Example", 3, false, "2097-01-10"],
        ["Ada E", 2, true, "2097-01-08"],
        ["stranger@example.com", 2, false, "2097-01-10"],
      ]);
      expect(giftedAttendees).toBe(1);
    });

    it("does not count a deactivated purchase, nor one purchase each of two different offers", async () => {
      const r = repos({
        kajabiPurchases: [
          purchase("p1", "c1", FULL),
          purchase("p2", "c1", FULL, { deactivated_at: "2097-02-01T00:00:00Z" }),
          purchase("p3", "c2", FULL),
          purchase("p4", "c2", DEPOSIT),
        ],
      });

      expect((await findKajabiMatchesForEvent(r, EVENT)).multiTicketBuyers).toEqual([]);
    });
  });

  describe("offers held in Kajabi without a purchase", () => {
    const withoutPurchase = (kajabiIds: Record<string, string | null>) =>
      repos({
        members: [
          { id: "mbr_AAAAAAAAAAA1", name: "Ada Example", email: "ada@example.com", kajabiId: kajabiIds.a },
          { id: "mbr_AAAAAAAAAAA2", name: "Bo Example", email: "bo@example.com", kajabiId: kajabiIds.b },
          { id: "mbr_AAAAAAAAAAA3", name: "Cy Example", email: "cy@example.com", kajabiId: kajabiIds.c },
        ],
        eventAttendees: ["a", "b", "c"].map((k, i) => ({ id: `a${i}`, event_id: EVENT, member_id: `mbr_AAAAAAAAAAA${i + 1}`, ticket_source: null })),
      });
    const byName = async (r: ReturnType<typeof repos>, lookup?: (id: string) => Promise<string[] | null>) =>
      Object.fromEntries((await findKajabiMatchesForEvent(r, EVENT, lookup)).attendeesWithoutTicket.map((a) => [a.member_name, a.kajabi_offer]));

    it("says held, not held, unknown or no contact", async () => {
      const r = withoutPurchase({ a: "k1", b: "k2", c: null });
      const lookup = async (id: string) => (id === "k1" ? ["other", FULL] : ["other"]);

      expect(await byName(r, lookup)).toEqual({ "Ada Example": "held", "Bo Example": "not_held", "Cy Example": "no_contact" });
    });

    it("says unknown when Kajabi does not answer, throws, or no lookup is given", async () => {
      const r = withoutPurchase({ a: "k1", b: "k2", c: "k3" });
      const lookup = async (id: string) => {
        if (id === "k1") return null;
        if (id === "k2") throw new Error("Kajabi is down");
        return [DEPOSIT];
      };

      expect(await byName(r, lookup)).toEqual({ "Ada Example": "unknown", "Bo Example": "unknown", "Cy Example": "held" });
      expect(await byName(r)).toEqual({ "Ada Example": "unknown", "Bo Example": "unknown", "Cy Example": "unknown" });
    });

    it("looks up a limited number of contacts, a few at a time", async () => {
      const members = Array.from({ length: 30 }, (_, i) => ({ id: `mbr_BBBBBBBBB${String(i).padStart(3, "0")}`, name: `Member ${i}`, email: `m${i}@example.com`, kajabiId: `k${i}` }));
      const r = repos({
        members,
        eventAttendees: members.map((m, i) => ({ id: `a${i}`, event_id: EVENT, member_id: m.id, ticket_source: null })),
      });
      let running = 0;
      let peak = 0;
      let calls = 0;
      const lookup = async () => {
        calls++;
        peak = Math.max(peak, ++running);
        await Promise.resolve();
        running--;
        return [] as string[];
      };

      const { attendeesWithoutTicket } = await findKajabiMatchesForEvent(r, EVENT, lookup);

      expect(calls).toBe(25);
      expect(peak).toBeLessThanOrEqual(4);
      expect(attendeesWithoutTicket.filter((a) => a.kajabi_offer === "unknown")).toHaveLength(5);
    });
  });
});
