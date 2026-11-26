import { clock } from "@/lib/clock";
import type { StripeChargeRow, StripeInvoiceRow, StripeSubscriptionRow } from "@/lib/data/billing";
import type { Repos } from "@/lib/data/repos";
import { MEMBERSHIP_PRODUCT_NAMES } from "@/lib/membership";
import {
  buildSchedules,
  easternDay,
  type PurchaseSchedule,
  type ReconCharge,
  type ReconInvoice,
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
  counts: { linkedMembers: number; invoices: number; charges: number; subscriptions: number };
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

const toReconCharge = (row: StripeChargeRow): ReconCharge => ({
  stripeChargeId: row.stripe_charge_id,
  stripeCustomerId: row.stripe_customer_id,
  stripeInvoiceId: row.stripe_invoice_id,
  status: row.status,
  amountCents: row.amount,
  amountRefundedCents: row.amount_refunded,
  failureCode: row.failure_code,
});

/** `billing_cycle_anchor` and the pause (`pause_collection`: behavior and `resumes_at`, Unix seconds) from the raw subscription. */
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
  };
}

/** The first day of the month `months` before the Eastern day `today`, as an instant. */
export const monthsAgoStart = (today: string, months: number) => {
  const [y, m] = today.split("-").map(Number);
  const index = y * 12 + (m - 1) - months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}-01T00:00:00.000Z`;
};

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
  return buildSchedules({
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
  });
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

  const involved = new Set(schedules.map((s) => s.memberId));
  return {
    schedules,
    members: new Map(
      allMembers.filter((m) => involved.has(m.id)).map((m) => [m.id, { id: m.id, name: m.name, displayName: m.displayName, status: m.status }])
    ),
    today,
    counts: { linkedMembers: linked.length, invoices: invoices.length, charges: charges.length, subscriptions: subscriptions.length },
  };
}
