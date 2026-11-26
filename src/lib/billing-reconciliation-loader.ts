import { clock } from "@/lib/clock";
import { buildPurchaseSchedules, type ReconOffer, type ReconOverride } from "@/lib/billing-purchases";
import { membersForPurchases } from "@/lib/kajabi-purchase-members";
import { loadOfferCoverage } from "@/lib/offer-coverage";
import type { StripeChargeRow, StripeInvoiceRow, StripeSubscriptionRow } from "@/lib/data/billing";
import type { Repos } from "@/lib/data/repos";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import {
  buildSchedules,
  easternDay,
  type PurchaseSchedule,
  type ReconCharge,
  type ReconInvoice,
  type ReconMember,
  type ReconSubscription,
  type ReconWindow,
} from "@/lib/billing-reconciliation";

/** How far back the overview reads invoices and charges (months). The overview's schedule looks back less (12); this is for hiatus and program windows that began earlier. One member's view reads everything. */
const BILLING_HISTORY_MONTHS = 24;

interface ReconciliationMember {
  id: string;
  name: string;
  displayName: string | null;
  status: string;
}

export interface BillingOverview {
  schedules: PurchaseSchedule[];
  /** The people the schedules are about, for names and links. */
  members: Map<string, ReconciliationMember>;
  /** Eastern day the report was computed for. */
  today: string;
  /** What was read, so an empty report can be told apart from an empty import. */
  counts: { linkedMembers: number; invoices: number; charges: number; subscriptions: number; purchases: number };
}

const toReconInvoice = (row: StripeInvoiceRow): ReconInvoice => ({
  stripeInvoiceId: row.stripe_invoice_id,
  stripeCustomerId: row.stripe_customer_id,
  stripeSubscriptionId: row.stripe_subscription_id,
  stripeProductId: row.stripe_product_id,
  status: row.status,
  amountDueCents: row.amount_due,
  amountPaidCents: row.amount_paid,
  currency: row.currency,
  createdAt: row.created_at_stripe,
  attemptCount: row.attempt_count,
  stripeChargeId: row.stripe_charge_id,
});

const kajabiOfferIdOf = (data: unknown): string | null => {
  const metadata = data && typeof data === "object" ? (data as { metadata?: unknown }).metadata : null;
  const id = metadata && typeof metadata === "object" ? (metadata as { kjb_offer_id?: unknown }).kjb_offer_id : null;
  return typeof id === "string" ? id : null;
};

const toReconCharge = (row: StripeChargeRow): ReconCharge => ({
  createdAt: row.created_at_stripe,
  description: row.description,
  kajabiOfferId: kajabiOfferIdOf(row.data),
  stripeChargeId: row.stripe_charge_id,
  stripeCustomerId: row.stripe_customer_id,
  stripeInvoiceId: row.stripe_invoice_id,
  status: row.status,
  amountCents: row.amount,
  amountRefundedCents: row.amount_refunded,
  failureCode: row.failure_code,
});

/** `billing_cycle_anchor`, `collection_method` and the pause (`pause_collection`: behavior and `resumes_at`, Unix seconds) from the raw subscription. */
/** Null for a subscription without a creation time: nothing can be expected of it. */
export function toReconSubscription(row: StripeSubscriptionRow): ReconSubscription | null {
  if (!row.created_at_stripe) return null;
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  const anchor = typeof data.billing_cycle_anchor === "number" ? new Date(data.billing_cycle_anchor * 1000).toISOString() : null;
  const pause = data.pause_collection && typeof data.pause_collection === "object" ? (data.pause_collection as Record<string, unknown>) : null;
  return {
    stripeSubscriptionId: row.stripe_subscription_id,
    stripeCustomerId: row.stripe_customer_id,
    status: row.status,
    createdAt: row.created_at_stripe,
    canceledAt: row.canceled_at,
    billingAnchor: anchor,
    paused: pause !== null,
    pauseBehavior: typeof pause?.behavior === "string" ? pause.behavior : null,
    pauseResumesAt: typeof pause?.resumes_at === "number" ? new Date(pause.resumes_at * 1000).toISOString() : null,
    kajabiOfferId: kajabiOfferIdOf(data),
    collectionMethod: typeof data.collection_method === "string" ? data.collection_method : null,
  };
}

/** The first day of the month `months` before the Eastern day `today`, as an instant. */
export const monthsAgoStart = (today: string, months: number) => {
  const [y, m] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`;
};

/** The offer ids Kajabi purchases are read for: events, programs and courses. */
interface PurchaseScope {
  today: string;
  /** The members the schedules are about (with their Stripe customers); schedules for anyone else are dropped. */
  members: ReconMember[];
  /** Every Stripe subscription row (the ones Kajabi made carry its offer id). */
  subscriptionRows: StripeSubscriptionRow[];
}

const priceTextOf = (data: unknown): string | null => {
  const attributes = (data as { attributes?: { price_description?: unknown } } | null)?.attributes;
  return typeof attributes?.price_description === "string" && attributes.price_description.trim() ? attributes.price_description.trim() : null;
};

const attributeOf = (data: unknown, key: string): unknown => ((data as { attributes?: Record<string, unknown> } | null)?.attributes ?? {})[key];

/**
 * The event, program and course purchases of some members, each lined up with its Stripe payments
 * (`buildPurchaseSchedules`). Reads, in parallel: the offers and what they map to, the Kajabi purchases of those
 * offers, the events with their attendees, marks and offer links, the status overrides, and the Stripe charges and
 * subscriptions that carry those offers' ids (whoever the Stripe customer is: the buyer's Kajabi email is not always
 * the Stripe customer's). The invoices of a payment plan's subscription come from its customer.
 */
export async function loadPurchaseSchedules(repos: Repos, scope: PurchaseScope): Promise<{ schedules: PurchaseSchedule[]; purchases: number }> {
  const [coverage, offerRows, events, links, tickets, marks, overrideRows] = await Promise.all([
    loadOfferCoverage(repos),
    repos.billing.kajabiOfferRows(),
    repos.events.listWithPhotoCounts(),
    repos.events.linkedOffers(),
    repos.events.ticketRecords(),
    repos.events.notAttendingMarks(),
    repos.memberStatus.allStatusOverrides(),
  ]);
  const membership = new Set<string>(MEMBERSHIP_PRODUCT_NAMES);
  const priceById = new Map(offerRows.map((o) => [o.kajabi_offer_id, priceTextOf(o.data)]));
  const eventOffers = new Set(links.map((l) => l.kajabi_offer_id));
  const offers = coverage.map((o): ReconOffer => {
    const kind = membership.has(o.name) ? "membership" : eventOffers.has(o.offerId) ? "event" : (o.resources.find((r) => r.kind === "program" || r.kind === "course")?.kind ?? "other");
    return { offerId: o.offerId, name: o.name, priceText: priceById.get(o.offerId) ?? null, kind };
  });
  const wantedOffers = offers.filter((o) => o.kind === "event" || o.kind === "program" || o.kind === "course").map((o) => o.offerId);
  if (wantedOffers.length === 0) return { schedules: [], purchases: 0 };

  const [purchaseRows, oneOffCharges] = await Promise.all([repos.billing.kajabiPurchaseRows({ offerIds: wantedOffers }), repos.billing.stripeChargesForKajabiOffers(wantedOffers)]);
  const { emailByCustomerId, memberByEmail } = await membersForPurchases(repos, purchaseRows);
  const inScope = new Set(scope.members.map((m) => m.id));
  const purchases = purchaseRows.flatMap((p) => {
    const email = p.kajabi_customer_id ? emailByCustomerId.get(p.kajabi_customer_id) : undefined;
    const member = email ? memberByEmail.get(email) : undefined;
    if (!member || !inScope.has(member.id) || !p.kajabi_offer_id || !p.created_at_kajabi) return [];
    const quantity = attributeOf(p.data, "quantity");
    const paymentType = attributeOf(p.data, "payment_type");
    return [
      {
        purchaseId: p.kajabi_purchase_id,
        memberId: member.id,
        offerId: p.kajabi_offer_id,
        createdAt: p.created_at_kajabi,
        deactivatedAt: p.deactivated_at,
        amountCents: p.amount_in_cents ?? 0,
        paymentType: typeof paymentType === "string" ? paymentType : null,
        quantity: typeof quantity === "number" ? quantity : null,
      },
    ];
  });

  // Payment plans: the subscriptions Kajabi made for these offers, and their customers' invoices and charges.
  const planSubscriptions = scope.subscriptionRows.filter((s) => {
    const offerId = kajabiOfferIdOf(s.data);
    return offerId !== null && wantedOffers.includes(offerId);
  });
  const planCustomers = [...new Set(planSubscriptions.map((s) => s.stripe_customer_id))];
  const [planInvoices, planCharges] = planCustomers.length > 0 ? await Promise.all([repos.billing.stripeInvoices({ customerIds: planCustomers }), repos.billing.stripeCharges({ customerIds: planCustomers })]) : [[], []];
  const charges = [...new Map([...oneOffCharges, ...planCharges].map((c) => [c.stripe_charge_id, c])).values()];

  const eventById = new Map(events.map((e) => [e.id, e]));
  const day = (value: string | null) => (value ? value.slice(0, 10) : null);
  const schedules = buildPurchaseSchedules({
    today: scope.today,
    members: scope.members,
    purchases,
    offers,
    events: events.map((e) => ({ id: e.id, slug: e.slug, title: e.title })),
    eventLinks: links.flatMap((l) => (eventById.has(l.event_id) ? [{ eventId: l.event_id, offerId: l.kajabi_offer_id, purchasedFrom: l.purchased_from, purchasedUntil: l.purchased_until }] : [])),
    attendees: tickets.map((t) => ({ eventId: t.event_id, memberId: t.member_id, source: t.ticket_source, giverId: t.ticket_giver_id, fromEventId: t.ticket_from_event_id })),
    notAttending: marks.map((m) => ({ eventId: m.event_id, memberId: m.member_id, reason: m.reason, note: m.note })),
    overrides: overrideRows.map((o): ReconOverride => ({ memberId: o.member_id ?? "", type: o.override_type, reason: o.reason, startsAt: day(o.starts_at), expiresAt: day(o.expires_at) })),
    invoices: planInvoices.map(toReconInvoice),
    charges: charges.map(toReconCharge),
    subscriptions: planSubscriptions.map(toReconSubscription).filter((s): s is ReconSubscription => s !== null),
  });
  return { schedules, purchases: purchases.length };
}

const todayEastern = () => easternDay(new Date(clock.now()).toISOString());

/**
 * One member's purchase schedules: their invoices and charges are already read (the Transactions tab
 * reads them anyway), the rest (subscriptions, hiatuses, program cohorts, membership products) is read
 * here in parallel. Use service-role repositories after the permission check.
 */
export async function loadMemberSchedules(
  repos: Repos,
  member: { id: string; status: string },
  customerIds: string[],
  invoices: StripeInvoiceRow[],
  charges: StripeChargeRow[]
): Promise<PurchaseSchedule[]> {
  if (customerIds.length === 0) return [];
  const [hiatuses, enrollments, products, subscriptionRows] = await Promise.all([
    repos.memberStatus.hiatusesOf(member.id),
    repos.programs.enrollmentsOf(member.id),
    repos.billing.stripeProductsByName([...MEMBERSHIP_PRODUCT_NAMES]),
    repos.billing.stripeSubscriptionRows(),
  ]);
  const customers = new Set(customerIds);
  const membership = buildSchedules({
    today: todayEastern(),
    members: [{ id: member.id, status: member.status, stripeCustomerIds: customerIds }],
    membershipProductIds: new Set(products.map((p) => p.stripe_product_id)),
    invoices: invoices.map(toReconInvoice),
    charges: charges.map(toReconCharge),
    subscriptions: subscriptionRows.filter((s) => customers.has(s.stripe_customer_id)).map(toReconSubscription).filter((s): s is ReconSubscription => s !== null),
    hiatuses: hiatuses.map((h): ReconWindow => ({ memberId: member.id, startDate: h.start_date, endDate: h.end_date })),
    programWindows: enrollments.filter((e) => e.includesMembership).map((e): ReconWindow => ({ memberId: member.id, startDate: e.startsAt, endDate: e.expiresAt })),
    // The member's own view covers their whole billing history, like the flat list (the caller reads every invoice and charge).
    lookbackMonths: null,
    membershipName: products.find((p) => invoices.some((i) => i.stripe_product_id === p.stripe_product_id))?.name,
  });
  const { schedules: purchases } = await loadPurchaseSchedules(repos, { today: todayEastern(), members: [{ id: member.id, status: member.status, stripeCustomerIds: customerIds }], subscriptionRows });
  return [...membership, ...purchases];
}

/**
 * Every member's schedules, for the overview of who has a problem. Reads in batches through the
 * repositories (members, hiatuses, program windows, products and subscriptions in parallel; then the
 * linked customers' invoices and charges, chunked and paged by the repository). The linked Stripe
 * customer only: a second customer under another email is on the member's own Transactions tab
 * (docs/TODO.md, "Support several Stripe customers per member").
 */
export async function loadBillingOverview(repos: Repos): Promise<BillingOverview> {
  const today = todayEastern();
  const [allMembers, hiatuses, programWindows, products, subscriptionRows] = await Promise.all([
    repos.members.list(),
    repos.memberStatus.allHiatuses(),
    repos.programs.membershipEnrollmentWindows(),
    repos.billing.stripeProductsByName([...MEMBERSHIP_PRODUCT_NAMES]),
    repos.billing.stripeSubscriptionRows(),
  ]);
  const linked = allMembers.filter((m) => m.stripeCustomerId);
  const customerIds = [...new Set(linked.map((m) => m.stripeCustomerId as string))];
  const customerSet = new Set(customerIds);
  const createdFrom = monthsAgoStart(today, BILLING_HISTORY_MONTHS);
  const [invoices, charges] = await Promise.all([
    repos.billing.stripeInvoices({ customerIds, createdFrom }),
    repos.billing.stripeCharges({ customerIds, createdFrom }),
  ]);
  const subscriptions = subscriptionRows.filter((s) => customerSet.has(s.stripe_customer_id)).map(toReconSubscription).filter((s): s is ReconSubscription => s !== null);

  const schedules = buildSchedules({
    today,
    members: linked.map((m) => ({ id: m.id, status: m.status, stripeCustomerIds: [m.stripeCustomerId as string] })),
    membershipProductIds: new Set(products.map((p) => p.stripe_product_id)),
    invoices: invoices.map(toReconInvoice),
    charges: charges.map(toReconCharge),
    subscriptions,
    hiatuses: hiatuses.map((h) => ({ memberId: h.member_id, startDate: h.start_date, endDate: h.end_date })),
    programWindows: programWindows.map((w) => ({ memberId: w.memberId, startDate: w.startsAt, endDate: w.expiresAt })),
  });
  // Events, programs and courses: every member counts, linked to Stripe or not (the payment is found through Kajabi's offer id).
  const reconMembers = allMembers.map((m): ReconMember => ({ id: m.id, status: m.status, stripeCustomerIds: m.stripeCustomerId ? [m.stripeCustomerId] : [] }));
  const purchaseResult = await loadPurchaseSchedules(repos, { today, members: reconMembers, subscriptionRows });
  schedules.push(...purchaseResult.schedules);

  const involved = new Set(schedules.map((s) => s.memberId));
  return {
    schedules,
    members: new Map(
      allMembers.filter((m) => involved.has(m.id)).map((m) => [m.id, { id: m.id, name: m.name, displayName: m.displayName, status: m.status }])
    ),
    today,
    counts: { linkedMembers: linked.length, invoices: invoices.length, charges: charges.length, subscriptions: subscriptions.length, purchases: purchaseResult.purchases },
  };
}
