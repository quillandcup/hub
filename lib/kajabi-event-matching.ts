import type { Repos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { membersForPurchases } from "@/lib/kajabi-purchase-members";
import { resolveMatchDate } from "@/lib/kajabi-cohort-matching";
import type { TicketSource } from "@/lib/event-tickets";

type EventRepos = Pick<Repos, "aliases" | "billing" | "events" | "members">;

/** Most Kajabi contacts looked up in one search, and how many at once. */
const GRANT_LOOKUP_LIMIT = 25;
const GRANT_LOOKUP_CONCURRENCY = 4;

/** A member who bought a ticket to the event and is not an attendee yet. */
export interface EventTicketBuyer {
  member_id: string;
  member_name: string;
  /** Their legal name when it differs from the name shown. */
  member_real_name: string | null;
  member_status: string;
  offer_names: string[];
  /** The earliest matching purchase's transaction date. */
  purchase_date: string | null;
  amount_in_cents: number | null;
  purchase_count: number;
  /** Every one of their purchases of these offers was deactivated: review before adding. */
  deactivated: boolean;
  /** An attendee with no ticket on record who may be the same person under another member record: merge them before adding this buyer. */
  possible_duplicate: PossibleDuplicate | null;
}

/** The other member record that a buyer or an attendee may be the same person as. */
export interface PossibleDuplicate {
  member_id: string;
  member_name: string;
}

/** A purchase whose buyer has no member in the Hub (a different email, or never joined). */
export interface UnmatchedBuyer {
  email: string;
  offer_names: string[];
  purchase_date: string | null;
}

/** An attendee with no matching purchase and no recorded reason (comped or gifted). */
export interface AttendeeWithoutTicket {
  member_id: string;
  member_name: string;
  ticket_source: TicketSource | null;
  /**
   * Whether Kajabi says the member's contact holds one of the event's offers although they bought none
   * (an offer granted from Kajabi's admin): "held", "not_held", "unknown" (Kajabi didn't answer) or
   * "no_contact" (the member has no Kajabi contact).
   */
  kajabi_offer: "held" | "not_held" | "unknown" | "no_contact";
  /** A buyer who is not an attendee and may be the same person under another member record. */
  possible_duplicate: PossibleDuplicate | null;
}

/** A buyer of more than one ticket to the event: the extra ones may be gifts for someone else. */
export interface MultiTicketBuyer {
  /** The member, or null when the buyer has no member (then `name` is their email). */
  member_id: string | null;
  name: string;
  tickets: number;
  first_bought: string | null;
  is_attendee: boolean;
}

export interface EventKajabiMatches {
  /** False when no offer is linked to the event yet. */
  offersLinked: boolean;
  /** Buyers of two or more tickets (active purchases of the same offer), most tickets first. */
  multiTicketBuyers: MultiTicketBuyer[];
  /** How many attendees are recorded as gifted, to set against the extra tickets. */
  giftedAttendees: number;
  buyers: EventTicketBuyer[];
  unmatched: UnmatchedBuyer[];
  attendeesWithoutTicket: AttendeeWithoutTicket[];
}

/** A name as people compare it: case, accents and extra spaces ignored. */
const nameKey = (name: string) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const EXPLAINED_WITHOUT_PURCHASE: ReadonlySet<TicketSource | null> = new Set(["comped", "gifted"]);

/**
 * Compares who bought the event's linked Kajabi offers with who is on its attendee list.
 * Read-only: nothing is added. Unlike the program cohorts there is no date window (an event's
 * offers belong to that event), and a buyer with no member is listed, not skipped.
 */
export async function findKajabiMatchesForEvent(
  repos: EventRepos,
  eventId: string,
  /** Reads the offer ids a Kajabi contact holds (null when Kajabi didn't say). Left out: nobody is looked up. */
  contactOfferIds?: (kajabiContactId: string) => Promise<string[] | null>
): Promise<EventKajabiMatches> {
  const offerIds = await repos.events.offerIdsOf(eventId);
  if (offerIds.length === 0) return { offersLinked: false, multiTicketBuyers: [], giftedAttendees: 0, buyers: [], unmatched: [], attendeesWithoutTicket: [] };

  const [offers, purchases, attendees] = await Promise.all([
    repos.billing.kajabiOffersByIds(offerIds),
    repos.billing.kajabiPurchases({ offerIds }),
    repos.events.attendeesOf(eventId),
  ]);
  const offerNameById = new Map(offers.map((o) => [o.kajabi_offer_id, o.name ?? "Unknown offer"]));
  const { emailByCustomerId, memberByEmail } = await membersForPurchases(repos, purchases);

  const memberById = new Map(Array.from(memberByEmail.values(), (m) => [m.id, m]));
  const attendeeIds = new Set(attendees.map((a) => a.member_id));
  type Accum = { purchases: typeof purchases; offerNames: Set<string> };
  const byMember = new Map<string, Accum>();
  const byUnmatchedEmail = new Map<string, Accum>();
  const buyerIds = new Set<string>();

  for (const p of purchases) {
    const email = p.kajabi_customer_id ? emailByCustomerId.get(p.kajabi_customer_id) : undefined;
    const member = email ? memberByEmail.get(email) : undefined;
    const name = (p.kajabi_offer_id && offerNameById.get(p.kajabi_offer_id)) || "Unknown offer";
    const target = member ? byMember : byUnmatchedEmail;
    const key = member ? member.id : (email ?? `customer:${p.kajabi_customer_id ?? p.kajabi_purchase_id}`);
    if (member) buyerIds.add(member.id);
    const acc = target.get(key) ?? { purchases: [], offerNames: new Set<string>() };
    acc.purchases.push(p);
    acc.offerNames.add(name);
    target.set(key, acc);
  }

  const earliest = (acc: Accum) => acc.purchases.map(resolveMatchDate).filter((d): d is string => !!d).sort()[0] ?? null;

  const buyers: EventTicketBuyer[] = [];
  // The names each buyer goes by (legal and shown), to compare with attendees that have no ticket.
  const legalNames = new Map<string, string[]>();
  for (const [memberId, acc] of byMember) {
    if (attendeeIds.has(memberId)) continue;
    const member = memberById.get(memberId)!;
    const display = getMemberDisplayName({ name: member.name, display_name: member.displayName });
    buyers.push({
      member_id: memberId,
      member_name: display,
      member_real_name: display !== member.name ? member.name : null,
      member_status: member.status,
      offer_names: Array.from(acc.offerNames),
      purchase_date: earliest(acc),
      amount_in_cents: acc.purchases.reduce((sum, p) => sum + (p.amount_in_cents ?? 0), 0),
      purchase_count: acc.purchases.length,
      deactivated: acc.purchases.every((p) => p.deactivated_at !== null),
      possible_duplicate: null,
    });
    legalNames.set(memberId, [member.name, display]);
  }
  buyers.sort((a, b) => (a.purchase_date ?? "").localeCompare(b.purchase_date ?? "") || a.member_name.localeCompare(b.member_name));

  const unmatched: UnmatchedBuyer[] = Array.from(byUnmatchedEmail, ([key, acc]) => ({
    email: key.startsWith("customer:") ? "(no email on the Kajabi customer)" : key,
    offer_names: Array.from(acc.offerNames),
    purchase_date: earliest(acc),
  })).sort((a, b) => (a.purchase_date ?? "").localeCompare(b.purchase_date ?? ""));

  const attendeesWithoutTicket: AttendeeWithoutTicket[] = attendees
    .filter((a) => !buyerIds.has(a.member_id) && !EXPLAINED_WITHOUT_PURCHASE.has(a.ticket_source))
    .map((a) => ({
      member_id: a.member_id,
      member_name: a.member ? getMemberDisplayName(a.member) : "Unknown",
      ticket_source: a.ticket_source,
      kajabi_offer: "unknown" as const,
      possible_duplicate: null,
    }));

  // The same name on both lists is usually one person with two member records (the roster has
  // one, the purchase belongs to the other). Say so on both sides, so staff merge instead of
  // adding the buyer a second time. Only a hint: two people can share a name.
  const attendeeNames = new Map(attendees.map((a) => [a.member_id, a.member ? [a.member.name, getMemberDisplayName(a.member)] : []]));
  for (const attendee of attendeesWithoutTicket) {
    const keys = new Set((attendeeNames.get(attendee.member_id) ?? []).map(nameKey));
    const buyer = buyers.find((b) => (legalNames.get(b.member_id) ?? []).some((n) => keys.has(nameKey(n))));
    if (!buyer) continue;
    attendee.possible_duplicate = { member_id: buyer.member_id, member_name: buyer.member_name };
    buyer.possible_duplicate = { member_id: attendee.member_id, member_name: attendee.member_name };
  }

  await checkGrants(repos, attendeesWithoutTicket, new Set(offerIds), contactOfferIds);

  // Two active purchases of the same offer are two tickets: Kajabi records no failed or pending
  // payments here, so the extra one is for someone else, whoever the buyer is.
  const multiTicketBuyers: MultiTicketBuyer[] = [];
  const addMulti = (acc: Accum, id: string | null, name: string) => {
    const perOffer = new Map<string, number>();
    for (const p of acc.purchases) if (p.deactivated_at === null) perOffer.set(p.kajabi_offer_id ?? "", (perOffer.get(p.kajabi_offer_id ?? "") ?? 0) + 1);
    const tickets = Math.max(0, ...perOffer.values());
    if (tickets > 1) multiTicketBuyers.push({ member_id: id, name, tickets, first_bought: earliest(acc), is_attendee: id !== null && attendeeIds.has(id) });
  };
  for (const [memberId, acc] of byMember) {
    const member = memberById.get(memberId);
    addMulti(acc, memberId, member ? getMemberDisplayName({ name: member.name, display_name: member.displayName }) : memberId);
  }
  for (const [key, acc] of byUnmatchedEmail) addMulti(acc, null, key.startsWith("customer:") ? "(no email on the Kajabi customer)" : key);
  multiTicketBuyers.sort((a, b) => b.tickets - a.tickets || (a.first_bought ?? "").localeCompare(b.first_bought ?? "") || a.name.localeCompare(b.name));

  const giftedAttendees = attendees.filter((a) => a.ticket_source === "gifted").length;
  return { offersLinked: true, multiTicketBuyers, giftedAttendees, buyers, unmatched, attendeesWithoutTicket };
}

/**
 * For attendees with no purchase, asks Kajabi whether their contact holds one of the event's offers
 * anyway: an offer granted from Kajabi's admin leaves no purchase, and our import does not keep a
 * contact's offers. Bounded (a few lookups at a time, at most GRANT_LOOKUP_LIMIT per search); anything
 * Kajabi doesn't answer stays "unknown".
 */
async function checkGrants(
  repos: Pick<Repos, "members">,
  attendees: AttendeeWithoutTicket[],
  eventOfferIds: Set<string>,
  contactOfferIds: ((kajabiContactId: string) => Promise<string[] | null>) | undefined
): Promise<void> {
  if (attendees.length === 0) return;
  const members = await repos.members.byIds(attendees.map((a) => a.member_id));
  const kajabiIdOf = new Map(members.map((m) => [m.id, m.kajabiId]));
  const queue: { attendee: AttendeeWithoutTicket; kajabiId: string }[] = [];
  for (const attendee of attendees) {
    const kajabiId = kajabiIdOf.get(attendee.member_id) ?? null;
    if (!kajabiId) attendee.kajabi_offer = "no_contact";
    else if (contactOfferIds && queue.length < GRANT_LOOKUP_LIMIT) queue.push({ attendee, kajabiId });
  }
  const lookup = contactOfferIds;
  if (!lookup) return;
  const work = [...queue];
  await Promise.all(
    Array.from({ length: Math.min(GRANT_LOOKUP_CONCURRENCY, work.length) }, async () => {
      for (let next = work.shift(); next; next = work.shift()) {
        try {
          const held = await lookup(next.kajabiId);
          next.attendee.kajabi_offer = held === null ? "unknown" : held.some((id) => eventOfferIds.has(id)) ? "held" : "not_held";
        } catch {
          next.attendee.kajabi_offer = "unknown";
        }
      }
    })
  );
}
