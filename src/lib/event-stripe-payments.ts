import type { Repos } from "@/lib/data/repos";
import type { StripeChargeRow, StripeInvoiceRow } from "@/lib/data/billing";
import { kajabiOfferIdOf } from "@/lib/kajabi-charge-metadata";
import { purchaseInWindow, type EventOfferLink } from "@/lib/event-offer-window";

/** What one member paid Stripe for an event's linked offers, in cents. */
export interface StripePayments {
  /** Everything charged and paid (failed charges excluded). */
  charged_cents: number;
  /** The part of it that was refunded. */
  refunded_cents: number;
}

/** A name as people compare it: case, accents, punctuation and spacing ignored. */
export const offerNameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Money the members paid in Stripe for an event's linked Kajabi offers, from the Bronze copy only
 * (no live Stripe call). Kajabi's own amount is not money paid: a payment plan is stored as one
 * purchase at the per-installment price, whatever was charged or refunded.
 *
 * The matching rule, checked against production data:
 * - A one-off offer (a deposit, a ticket): Kajabi names the Stripe charge after the offer, so a charge
 *   of the buyer's Stripe customer whose description equals the offer's name (ignoring case,
 *   punctuation and spacing) is a payment for it. The charge's own date must fall in the link's window.
 * - A payment plan: Stripe keeps it as a subscription whose metadata carries the Kajabi offer id
 *   (`kjb_offer_id`, or `platform_product_ID` in Kajabi's newer shape) and whose plan nickname is the offer's name. Every invoice of that subscription
 *   is a payment for it, and the subscription's creation date must fall in the link's window (the
 *   instalments run past the window's end). The invoice's charge says what was refunded.
 * - A payment is counted once: an invoice's charge appears in both tables, and several linked offers
 *   with the same name or a charge reached by both rules never count it twice. An invoice with no stored
 *   charge counts at its amount paid with nothing refunded.
 * - Only the buyer's Stripe customer (`members.stripe_customer_id`) is looked at; a member without one
 *   has no figure (absent from the result).
 */
export async function stripePaymentsForEvent(
  repos: Pick<Repos, "billing">,
  links: EventOfferLink[],
  offerNames: Map<string, string>,
  /** Stripe customer id by member id; members without one are left out by the caller or null. */
  stripeCustomerByMember: Map<string, string | null>
): Promise<Map<string, StripePayments>> {
  const result = new Map<string, StripePayments>();
  const customerIds = Array.from(new Set([...stripeCustomerByMember.values()].filter((id): id is string => !!id)));
  if (customerIds.length === 0 || links.length === 0) return result;

  const [charges, invoices, subscriptions] = await Promise.all([
    repos.billing.stripeCharges({ customerIds }),
    repos.billing.stripeInvoices({ customerIds }),
    repos.billing.stripeSubscriptionsByCustomers(customerIds),
  ]);

  const linksByNameKey = new Map<string, EventOfferLink[]>();
  for (const link of links) {
    const name = offerNames.get(link.kajabi_offer_id);
    if (!name) continue;
    const key = offerNameKey(name);
    linksByNameKey.set(key, [...(linksByNameKey.get(key) ?? []), link]);
  }
  const linksByOfferId = new Map<string, EventOfferLink[]>();
  for (const link of links) linksByOfferId.set(link.kajabi_offer_id, [...(linksByOfferId.get(link.kajabi_offer_id) ?? []), link]);

  const inAnyWindow = (candidates: EventOfferLink[], instant: string) => candidates.some((l) => purchaseInWindow({ created_at_kajabi: instant }, l));

  // Payment plans: the subscriptions bought on a linked offer, inside its window.
  const planSubscriptions = new Set<string>();
  for (const s of subscriptions) {
    const data = (s.data ?? {}) as { plan?: { nickname?: unknown } };
    const offerId = kajabiOfferIdOf(data);
    const nickname = typeof data.plan?.nickname === "string" ? data.plan.nickname : null;
    const candidates = (offerId ? linksByOfferId.get(offerId) : undefined) ?? (nickname ? linksByNameKey.get(offerNameKey(nickname)) : undefined);
    if (candidates && inAnyWindow(candidates, s.created_at_stripe ?? "")) planSubscriptions.add(s.stripe_subscription_id);
  }

  // The payments, each once: by charge id, or by invoice id for an invoice with no stored charge.
  const chargeById = new Map<string, StripeChargeRow>(charges.map((c) => [c.stripe_charge_id, c]));
  const counted = new Map<string, { customer: string; charged: number; refunded: number }>();
  const addCharge = (c: StripeChargeRow) => {
    if (!c.paid || !c.stripe_customer_id || counted.has(c.stripe_charge_id)) return;
    counted.set(c.stripe_charge_id, { customer: c.stripe_customer_id, charged: c.amount, refunded: Math.min(c.amount_refunded, c.amount) });
  };
  for (const c of charges) {
    const candidates = c.description ? linksByNameKey.get(offerNameKey(c.description)) : undefined;
    if (candidates && inAnyWindow(candidates, c.created_at_stripe)) addCharge(c);
  }
  const chargeOfInvoice = (i: StripeInvoiceRow) => (i.stripe_charge_id ? chargeById.get(i.stripe_charge_id) : undefined) ?? charges.find((c) => c.stripe_invoice_id === i.stripe_invoice_id);
  for (const i of invoices) {
    if (!i.stripe_subscription_id || !planSubscriptions.has(i.stripe_subscription_id) || !i.stripe_customer_id) continue;
    const charge = chargeOfInvoice(i);
    if (charge) addCharge(charge);
    else if (i.amount_paid > 0 && !counted.has(`invoice:${i.stripe_invoice_id}`)) counted.set(`invoice:${i.stripe_invoice_id}`, { customer: i.stripe_customer_id, charged: i.amount_paid, refunded: 0 });
  }

  const memberOfCustomer = new Map<string, string[]>();
  for (const [memberId, customerId] of stripeCustomerByMember) if (customerId) memberOfCustomer.set(customerId, [...(memberOfCustomer.get(customerId) ?? []), memberId]);
  for (const payment of counted.values()) {
    for (const memberId of memberOfCustomer.get(payment.customer) ?? []) {
      const total = result.get(memberId) ?? { charged_cents: 0, refunded_cents: 0 };
      total.charged_cents += payment.charged;
      total.refunded_cents += payment.refunded;
      result.set(memberId, total);
    }
  }
  return result;
}

const dollars = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;

/** What staff read: "$510 charged · $260 refunded · net $250", "$250 paid" when nothing was refunded. */
export function stripePaymentsText(p: StripePayments | null): string {
  if (!p || p.charged_cents === 0) return "no Stripe payments found";
  if (p.refunded_cents === 0) return `${dollars(p.charged_cents)} paid`;
  return `${dollars(p.charged_cents)} charged · ${dollars(p.refunded_cents)} refunded · net ${dollars(p.charged_cents - p.refunded_cents)}`;
}
