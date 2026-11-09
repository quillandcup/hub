import type { Repos } from "@/lib/data/repos";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { membersForPurchases } from "@/lib/kajabi-purchase-members";
import { resolveMatchDate } from "@/lib/kajabi-cohort-matching";
import type { TicketSource } from "@/lib/event-tickets";

type EventRepos = Pick<Repos, "aliases" | "billing" | "events" | "members">;

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
}

/** A purchase whose buyer has no member in the Hub (a different email, or never joined). */
export interface UnmatchedBuyer {
  email: string;
  offer_names: string[];
  purchase_date: string | null;
}

/** An attendee with no matching purchase and no recorded reason (comped, gifted, donated). */
export interface AttendeeWithoutTicket {
  member_id: string;
  member_name: string;
  ticket_source: TicketSource | null;
}

export interface EventKajabiMatches {
  /** False when no offer is linked to the event yet. */
  offersLinked: boolean;
  buyers: EventTicketBuyer[];
  unmatched: UnmatchedBuyer[];
  attendeesWithoutTicket: AttendeeWithoutTicket[];
}

const EXPLAINED_WITHOUT_PURCHASE: ReadonlySet<TicketSource | null> = new Set(["comped", "gifted", "donated"]);

/**
 * Compares who bought the event's linked Kajabi offers with who is on its attendee list.
 * Read-only: nothing is added. Unlike the program cohorts there is no date window (an event's
 * offers belong to that event), and a buyer with no member is listed, not skipped.
 */
export async function findKajabiMatchesForEvent(repos: EventRepos, eventId: string): Promise<EventKajabiMatches> {
  const offerIds = await repos.events.offerIdsOf(eventId);
  if (offerIds.length === 0) return { offersLinked: false, buyers: [], unmatched: [], attendeesWithoutTicket: [] };

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
    });
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
    }));

  return { offersLinked: true, buyers, unmatched, attendeesWithoutTicket };
}
