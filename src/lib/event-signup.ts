import { purchaseCountsForEvent, type EventOfferLink } from "@/lib/event-offer-window";
import type { Repos } from "@/lib/data/repos";
import { membersForPurchases } from "@/lib/kajabi-purchase-members";

type SignupRepos = Pick<Repos, "aliases" | "billing" | "events" | "members">;

/** What a member needs to join an event that sells tickets through Kajabi. Counts and a public link only, never who bought. */
export interface EventSignup {
  /** Kajabi's checkout page for the first linked offer; null when the offer has none. */
  checkoutUrl: string | null;
  /** Places left, or null when the event has no limit. Never below 0. */
  spotsLeft: number | null;
  soldOut: boolean;
}

/** The checkout link in a Kajabi offer's raw record, or null. Only an http(s) link is passed on. */
export function checkoutUrlOf(data: unknown): string | null {
  const url = (data as { attributes?: { checkout_url?: unknown } } | null)?.attributes?.checkout_url;
  if (typeof url !== "string") return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

/**
 * The sign-up state of each event that has a Kajabi offer linked: the offer's checkout link and, for an
 * event with a capacity, how many places are left. Run it with the service role (the linked offers, the
 * purchases and the buyers are staff-only data); the result holds no personal data.
 *
 * A place is taken by a person who is an attendee or holds an active purchase of one of the event's offers,
 * counted once however many tickets or offers they bought, so the last place sells out when it is paid for
 * and not when staff add the buyer. Events with no linked offer are absent from the result.
 */
export async function eventSignups(repos: SignupRepos, events: { id: string; capacity: number | null }[]): Promise<Map<string, EventSignup>> {
  const result = new Map<string, EventSignup>();
  if (events.length === 0) return result;

  const linked = await repos.events.linkedOffers();
  const offersOf = new Map<string, string[]>();
  const linksOf = new Map<string, EventOfferLink[]>();
  for (const l of linked) {
    offersOf.set(l.event_id, [...(offersOf.get(l.event_id) ?? []), l.kajabi_offer_id]);
    linksOf.set(l.event_id, [...(linksOf.get(l.event_id) ?? []), l]);
  }

  const withOffers = events.filter((e) => offersOf.has(e.id));
  if (withOffers.length === 0) return result;

  const allOfferIds = Array.from(new Set(withOffers.flatMap((e) => offersOf.get(e.id)!)));
  const needsCount = withOffers.filter((e) => e.capacity !== null);
  const [offers, purchases] = await Promise.all([
    repos.billing.kajabiOffersByIds(allOfferIds),
    needsCount.length > 0 ? repos.billing.kajabiPurchases({ offerIds: Array.from(new Set(needsCount.flatMap((e) => offersOf.get(e.id)!))) }) : [],
  ]);
  const offerById = new Map(offers.map((o) => [o.kajabi_offer_id, o]));
  const { emailByCustomerId, memberByEmail } = await membersForPurchases(repos, purchases);
  const attendees = new Map(await Promise.all(needsCount.map(async (e) => [e.id, await repos.events.attendeesOf(e.id)] as const)));

  for (const event of withOffers) {
    const ids = offersOf.get(event.id)!;
    const checkoutUrl = ids.map((id) => checkoutUrlOf(offerById.get(id)?.data)).find((u) => u !== null) ?? null;
    if (event.capacity === null) {
      result.set(event.id, { checkoutUrl, spotsLeft: null, soldOut: false });
      continue;
    }
    const taken = new Set((attendees.get(event.id) ?? []).map((a) => `m:${a.member_id}`));
    for (const p of purchases) {
      if (p.deactivated_at || !p.kajabi_offer_id || !ids.includes(p.kajabi_offer_id) || !purchaseCountsForEvent(p, linksOf.get(event.id) ?? [])) continue;
      const email = p.kajabi_customer_id ? emailByCustomerId.get(p.kajabi_customer_id) : undefined;
      const member = email ? memberByEmail.get(email) : undefined;
      taken.add(member ? `m:${member.id}` : `b:${email ?? p.kajabi_customer_id ?? p.kajabi_purchase_id}`);
    }
    const spotsLeft = Math.max(0, event.capacity - taken.size);
    result.set(event.id, { checkoutUrl, spotsLeft, soldOut: spotsLeft === 0 });
  }
  return result;
}

/** "Sold out!" or "3 places left", the words shown beside an event that has a capacity; null when there is no limit to count against. */
export function spotsLabel(signup: Pick<EventSignup, "spotsLeft" | "soldOut"> | null | undefined): string | null {
  if (!signup || signup.spotsLeft === null) return null;
  if (signup.soldOut) return "Sold out!";
  return `${signup.spotsLeft} ${signup.spotsLeft === 1 ? "place" : "places"} left`;
}
