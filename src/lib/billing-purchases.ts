import {
  easternDay,
  transactionStatus,
  transactionsOf,
  type PurchaseSchedule,
  type PurchaseType,
  type ReconCharge,
  type ReconInvoice,
  type ReconMember,
  type ReconSubscription,
  type RowCause,
  type RowStatus,
  type ScheduleRow,
  type ScheduleTransaction,
} from "@/lib/billing-reconciliation";

/**
 * Billing reconciliation for what a member bought in Kajabi that is not the membership: events (retreats),
 * programs and courses. The unit is one Kajabi purchase, lined up against the Stripe payments Kajabi collected
 * through our Stripe account (about 99% of them). Pure: plain inputs in, `PurchaseSchedule`s out; the loader
 * (`src/lib/billing-reconciliation-loader.ts`) reads the inputs. Docs: docs/architecture/BILLING_RECONCILIATION.md.
 *
 * How a purchase finds its payment (checked against production: 306 of 352 single purchases of event offers
 * match a charge by customer email, and all 352 by offer, amount and day; 32 of 32 payment plans match a
 * subscription by offer and day):
 * - Kajabi writes its offer id into the metadata of the Stripe charge (`kjb_offer_id`) and of the subscription
 *   of a payment plan. A single purchase matches an unclaimed charge with no invoice of the same offer within
 *   `MATCH_DAYS` days of the purchase; a payment plan matches the subscription of that offer created within
 *   `MATCH_DAYS` days, and its invoices are the payments. The buyer's Kajabi email is not required to be the
 *   Stripe customer's (it differs about one time in eight), so ties go to the member's own customer, then to the
 *   equal amount, then to the nearest day.
 * - A purchase left over also matches a charge of the member's customers whose description is the offer's name
 *   (what Kajabi writes when the metadata is missing).
 * - Each charge and subscription is used once. A charge of an event, program or course offer that no purchase
 *   claims is listed as a payment with no purchase.
 *
 * What is expected of an event (attendee and mark records are the Hub's, `src/lib/kajabi-event-matching.ts`):
 * an attendee with no ticket source paid; comped, gifted and transferred tickets expect nothing here (a transferred
 * ticket's payment belongs to the origin event); someone who paid and is not attending needs a mark (forfeited or
 * other), or their ticket went to someone (gifted) or to another event (transferred). A retreat can be paid in
 * parts: payments are listed, never summed to a guessed total.
 *
 * A purchase of 0 is a grant. It is often our workaround for a gift, a comp or a payment taken directly in
 * Stripe, so the member's status override says what to expect (`member_status_overrides`: gift and special expect
 * no payment, direct_stripe expects Stripe payments); with none on record it needs a look.
 */

/** A purchase and a charge or subscription match at most this many days apart. */
export const PURCHASE_MATCH_DAYS = 2;

export interface ReconKajabiPurchase {
  purchaseId: string;
  memberId: string;
  offerId: string;
  /** ISO instants. */
  createdAt: string;
  deactivatedAt: string | null;
  /** What was charged, in cents; 0 is a grant. */
  amountCents: number;
  /** Kajabi's `payment_type`: "single", "multipay" or "subscription". */
  paymentType: string | null;
  quantity: number | null;
}

export interface ReconOffer {
  offerId: string;
  name: string;
  /** Kajabi's price description, such as "$47.00 every month". */
  priceText: string | null;
  kind: "membership" | "event" | "program" | "course" | "other";
}

export interface ReconEvent {
  id: string;
  slug: string;
  title: string;
}

/** An offer linked to an event, for purchases on the days from `purchasedFrom` to `purchasedUntil` (Eastern, inclusive, either may be open). */
export interface ReconEventLink {
  eventId: string;
  offerId: string;
  purchasedFrom: string | null;
  purchasedUntil: string | null;
}

export interface ReconAttendee {
  eventId: string;
  memberId: string;
  /** How they got in; null is a ticket they bought. */
  source: "comped" | "gifted" | "transferred" | null;
  /** The member who gave the ticket (a gifted source). */
  giverId: string | null;
  /** The event the ticket was bought for (a transferred source). */
  fromEventId: string | null;
}

export interface ReconNotAttending {
  eventId: string;
  memberId: string;
  reason: "forfeited" | "other";
  note: string | null;
}

/** A row of `member_status_overrides`. */
export interface ReconOverride {
  memberId: string;
  type: "gift" | "special" | "direct_stripe" | string;
  reason: string | null;
  /** Days (YYYY-MM-DD); open ends are null. */
  startsAt: string | null;
  expiresAt: string | null;
}

export interface PurchaseReconInput {
  today: string;
  members: ReconMember[];
  purchases: ReconKajabiPurchase[];
  offers: ReconOffer[];
  events: ReconEvent[];
  eventLinks: ReconEventLink[];
  attendees: ReconAttendee[];
  notAttending: ReconNotAttending[];
  overrides: ReconOverride[];
  invoices: ReconInvoice[];
  charges: ReconCharge[];
  subscriptions: ReconSubscription[];
}

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const nameKey = (name: string) => name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const dayGap = (a: string, b: string) => Math.abs(Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000));
const inWindow = (day: string, from: string | null, until: string | null) => (from === null || day >= from) && (until === null || day <= until);

/** The event a purchase of the offer on that Eastern day counts for: the link whose window holds the day. */
function eventOf(links: ReconEventLink[], offerId: string, day: string): string | null {
  return links.find((l) => l.offerId === offerId && inWindow(day, l.purchasedFrom, l.purchasedUntil))?.eventId ?? null;
}

const chargeTransaction = (c: ReconCharge): ScheduleTransaction => {
  const paid = c.status === "succeeded";
  return {
    invoiceId: c.stripeChargeId,
    kind: "charge",
    chargeIds: [c.stripeChargeId],
    day: easternDay(c.createdAt ?? ""),
    billedCents: c.amountCents,
    keptCents: paid ? Math.max(0, c.amountCents - c.amountRefundedCents) : 0,
    refundedCents: paid ? c.amountRefundedCents : 0,
    invoiceStatus: paid ? "paid" : "open",
    failureCodes: c.status === "failed" ? [c.failureCode ?? "failed"] : [],
    attempts: 1,
  };
};

interface Block {
  memberId: string;
  type: PurchaseType;
  eventId: string | null;
  purchase: ReconKajabiPurchase | null;
  offer: ReconOffer | null;
  payments: ScheduleTransaction[];
  /** The Stripe subscription of a payment plan. */
  subscription: ReconSubscription | null;
  rows: Omit<ScheduleRow, "key">[];
}

const txReason = (tx: ScheduleTransaction, status: RowStatus) =>
  status === "paid"
    ? `${money(tx.keptCents)} paid on ${tx.day}${tx.refundedCents > 0 ? `; ${money(tx.refundedCents)} was refunded` : ""}.`
    : status === "refunded"
      ? `${money(tx.refundedCents)} paid on ${tx.day} and refunded in full.`
      : status === "failed"
        ? `${money(tx.billedCents)} on ${tx.day} failed${tx.failureCodes.length ? ` (${tx.failureCodes.join(", ")})` : ""}.`
        : `${money(tx.billedCents)} on ${tx.day} is not paid yet.`;

/** Every event, program and course purchase as a schedule, plus the events members attend with no purchase on record. */
export function buildPurchaseSchedules(input: PurchaseReconInput): PurchaseSchedule[] {
  const offerById = new Map(input.offers.map((o) => [o.offerId, o]));
  const eventById = new Map(input.events.map((e) => [e.id, e]));
  const memberById = new Map(input.members.map((m) => [m.id, m]));
  const customerMember = new Map<string, string>();
  for (const m of input.members) for (const c of m.stripeCustomerIds) customerMember.set(c, m.id);

  const invoiceCharges = new Set(input.invoices.map((i) => i.stripeChargeId).filter((c): c is string => !!c));
  const oneOffCharges = input.charges.filter((c) => !c.stripeInvoiceId && !invoiceCharges.has(c.stripeChargeId) && c.createdAt);
  const chargesByInvoice = new Map<string, ReconCharge[]>();
  for (const c of input.charges) if (c.stripeInvoiceId) chargesByInvoice.set(c.stripeInvoiceId, [...(chargesByInvoice.get(c.stripeInvoiceId) ?? []), c]);
  const chargeById = new Map(input.charges.map((c) => [c.stripeChargeId, c]));

  const dayOf = (p: ReconKajabiPurchase) => easternDay(p.createdAt);
  const wanted = (p: ReconKajabiPurchase) => {
    const kind = offerById.get(p.offerId)?.kind;
    if (kind === "event") return eventOf(input.eventLinks, p.offerId, dayOf(p)) !== null;
    return kind === "program" || kind === "course";
  };
  const purchases = input.purchases.filter(wanted).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.purchaseId.localeCompare(b.purchaseId));
  const customersOf = (memberId: string) => new Set(memberById.get(memberId)?.stripeCustomerIds ?? []);

  // ---- match purchases to payments, best pairs first, each charge and subscription once.
  const claimedCharges = new Set<string>();
  const claimedSubs = new Set<string>();
  const chargeFor = new Map<string, ReconCharge>();
  const subFor = new Map<string, ReconSubscription>();

  type Pair = { p: ReconKajabiPurchase; charge?: ReconCharge; sub?: ReconSubscription; score: (number | string)[] };
  const pairs: Pair[] = [];
  for (const p of purchases) {
    const day = dayOf(p);
    const customers = customersOf(p.memberId);
    const plan = p.paymentType === "multipay" || p.paymentType === "subscription";
    if (plan) {
      for (const sub of input.subscriptions) {
        const meta = sub.kajabiOfferId;
        if (meta !== p.offerId) continue;
        const gap = dayGap(easternDay(sub.createdAt), day);
        if (gap <= PURCHASE_MATCH_DAYS) pairs.push({ p, sub, score: [customers.has(sub.stripeCustomerId) ? 0 : 1, gap, sub.stripeSubscriptionId] });
      }
    } else {
      for (const charge of oneOffCharges) {
        if (charge.kajabiOfferId !== p.offerId) continue;
        const gap = dayGap(easternDay(charge.createdAt as string), day);
        if (gap > PURCHASE_MATCH_DAYS) continue;
        pairs.push({
          p,
          charge,
          score: [charge.status === "succeeded" ? 0 : 1, customers.has(charge.stripeCustomerId ?? "") ? 0 : 1, charge.amountCents === p.amountCents ? 0 : 1, gap, charge.stripeChargeId],
        });
      }
    }
  }
  const compare = (a: Pair, b: Pair) => {
    for (let i = 0; i < Math.max(a.score.length, b.score.length); i++) {
      const x = a.score[i];
      const y = b.score[i];
      if (x === y) continue;
      return typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    }
    return a.p.purchaseId.localeCompare(b.p.purchaseId);
  };
  for (const pair of pairs.sort(compare)) {
    if (pair.charge ? claimedCharges.has(pair.charge.stripeChargeId) : claimedSubs.has((pair.sub as ReconSubscription).stripeSubscriptionId)) continue;
    if (chargeFor.has(pair.p.purchaseId) || subFor.has(pair.p.purchaseId)) continue;
    if (pair.charge) {
      claimedCharges.add(pair.charge.stripeChargeId);
      chargeFor.set(pair.p.purchaseId, pair.charge);
    } else if (pair.sub) {
      claimedSubs.add(pair.sub.stripeSubscriptionId);
      subFor.set(pair.p.purchaseId, pair.sub);
    }
  }
  // What is left matches the member's own charges by the offer's name (the description Kajabi gives them).
  for (const p of purchases) {
    if (chargeFor.has(p.purchaseId) || subFor.has(p.purchaseId) || p.paymentType === "multipay" || p.paymentType === "subscription") continue;
    const offer = offerById.get(p.offerId);
    const customers = customersOf(p.memberId);
    const key = offer ? nameKey(offer.name) : null;
    const found = oneOffCharges
      .filter((c) => !claimedCharges.has(c.stripeChargeId) && key && c.description && nameKey(c.description) === key && customers.has(c.stripeCustomerId ?? "") && dayGap(easternDay(c.createdAt as string), dayOf(p)) <= PURCHASE_MATCH_DAYS)
      .sort((a, b) => dayGap(easternDay(a.createdAt as string), dayOf(p)) - dayGap(easternDay(b.createdAt as string), dayOf(p)))[0];
    if (found) {
      claimedCharges.add(found.stripeChargeId);
      chargeFor.set(p.purchaseId, found);
    }
  }

  const txOfSub = (sub: ReconSubscription): ScheduleTransaction[] =>
    transactionsOf(input.invoices.filter((i) => i.stripeSubscriptionId === sub.stripeSubscriptionId && i.status !== "draft" && i.status !== "void"), chargesByInvoice, chargeById);

  const overrideAt = (memberId: string, day: string) =>
    input.overrides.find((o) => o.memberId === memberId && (o.startsAt === null || o.startsAt.slice(0, 10) <= day) && (o.expiresAt === null || o.expiresAt.slice(0, 10) >= day)) ?? null;

  // ---- one block per purchase.
  const blocks: Block[] = [];
  for (const p of purchases) {
    const offer = offerById.get(p.offerId) ?? null;
    const type: PurchaseType = offer?.kind === "event" ? "event" : offer?.kind === "program" ? "program" : "course";
    const eventId = type === "event" ? eventOf(input.eventLinks, p.offerId, dayOf(p)) : null;
    const charge = chargeFor.get(p.purchaseId);
    const subscription = subFor.get(p.purchaseId) ?? null;
    blocks.push({ memberId: p.memberId, type, eventId, purchase: p, offer, subscription, payments: charge ? [chargeTransaction(charge)] : subscription ? txOfSub(subscription) : [], rows: [] });
  }

  // ---- charges of these offers that no purchase claimed: a payment with no purchase on record.
  const orphanBlocks = new Map<string, Block>();
  for (const charge of oneOffCharges) {
    if (claimedCharges.has(charge.stripeChargeId) || !charge.kajabiOfferId) continue;
    const offer = offerById.get(charge.kajabiOfferId);
    const memberId = charge.stripeCustomerId ? customerMember.get(charge.stripeCustomerId) : undefined;
    if (!offer || !memberId || (offer.kind !== "event" && offer.kind !== "program" && offer.kind !== "course")) continue;
    const day = easternDay(charge.createdAt as string);
    const eventId = offer.kind === "event" ? eventOf(input.eventLinks, offer.offerId, day) : null;
    if (offer.kind === "event" && !eventId) continue;
    const key = `${memberId}:${offer.kind}:${eventId ?? offer.offerId}`;
    const block = orphanBlocks.get(key) ?? { memberId, type: offer.kind as PurchaseType, eventId, purchase: null, offer, subscription: null, payments: [], rows: [] };
    block.payments.push(chargeTransaction(charge));
    orphanBlocks.set(key, block);
  }
  blocks.push(...orphanBlocks.values());

  // ---- rows per block.
  const paymentRow = (tx: ScheduleTransaction, extra: Partial<Omit<ScheduleRow, "key">> = {}): Omit<ScheduleRow, "key"> => {
    const status = transactionStatus(tx);
    return { expectedDate: null, expectedAmountCents: null, month: tx.day.slice(0, 7), currency: "usd", status, reason: txReason(tx, status), needsAttention: false, cause: null, transactions: [tx], ...extra };
  };
  const noPaymentRow = (block: Block, status: RowStatus, reason: string, needsAttention: boolean, cause: RowCause = null): Omit<ScheduleRow, "key"> => {
    const day = block.purchase ? dayOf(block.purchase) : null;
    return { expectedDate: day, expectedAmountCents: block.purchase?.amountCents || null, month: (day ?? input.today).slice(0, 7), currency: "usd", status, reason, needsAttention, cause, transactions: [] };
  };
  const attendeeOf = (memberId: string, eventId: string) => input.attendees.find((a) => a.memberId === memberId && a.eventId === eventId);

  for (const block of blocks) {
    const { purchase, payments } = block;
    const day = purchase ? dayOf(purchase) : (payments[0]?.day ?? input.today);
    const granted = purchase !== null && purchase.amountCents === 0;
    const override = granted ? overrideAt(block.memberId, day) : null;
    const direct = override?.type === "direct_stripe";
    const why = override ? ` Override on record: ${override.type === "direct_stripe" ? "paid directly in Stripe" : override.type}${override.reason ? ` (${override.reason})` : ""}.` : "";
    const cancelled = purchase?.deactivatedAt != null;

    if (granted) {
      if (payments.length === 0) {
        block.rows.push(
          !override
            ? noPaymentRow(block, "granted_no_override", "Granted in Kajabi with no price, and no gift, comp or direct-Stripe override on record for the member: record which it is.", true, "granted")
            : direct
              ? noPaymentRow(block, "missing_payment", `Granted in Kajabi and paid directly in Stripe, but no Stripe payment was found.${why}`, true, "granted")
              : noPaymentRow(block, "granted_no_payment", `Granted in Kajabi, so no payment is expected.${why}`, false, "granted")
        );
      }
      for (const tx of payments) {
        block.rows.push(
          direct
            ? paymentRow(tx, { status: "granted_paid_stripe", reason: `${txReason(tx, transactionStatus(tx))} Granted in Kajabi and paid in Stripe, explained by the override.${why}`, cause: "granted" })
            : override
              ? paymentRow(tx, { status: "unexpected", reason: `${txReason(tx, transactionStatus(tx))} Granted in Kajabi with a ${override.type} override, which expects no payment.`, needsAttention: true, cause: "granted" })
              : paymentRow(tx, { status: "paid_override_missing", reason: `${txReason(tx, transactionStatus(tx))} Granted in Kajabi but paid in Stripe: record a direct-Stripe override for the member.`, needsAttention: true, cause: "granted" })
        );
      }
      continue;
    }
    if (payments.length === 0 && purchase) {
      if (cancelled) block.rows.push(noPaymentRow(block, "not_expected", `The purchase was cancelled in Kajabi on ${easternDay(purchase.deactivatedAt as string)}, with no Stripe payment found.`, false));
      else block.rows.push(noPaymentRow(block, "missing_payment", `Bought in Kajabi on ${day} for ${money(purchase.amountCents)}, but no Stripe payment was found.`, true));
    }
    for (const tx of payments) {
      block.rows.push(
        paymentRow(tx, !purchase ? { status: tx.invoiceStatus === "paid" && transactionStatus(tx) === "paid" ? "paid" : transactionStatus(tx), reason: `${txReason(tx, transactionStatus(tx))} No Kajabi purchase is on record for it.` } : {})
      );
    }
  }

  // ---- event verdicts: what the Hub says about attending, against what was paid.
  // Only an event that sells tickets through a linked offer expects payments: a free session has none to line up.
  const selling = new Set(input.eventLinks.map((l) => l.eventId));
  const eventIds = new Set([...input.attendees.map((a) => a.eventId), ...blocks.flatMap((b) => (b.eventId ? [b.eventId] : []))].filter((id) => selling.has(id)));
  const receivers = new Map<string, number>();
  for (const a of input.attendees) if (a.source === "gifted" && a.giverId) receivers.set(`${a.eventId}:${a.giverId}`, (receivers.get(`${a.eventId}:${a.giverId}`) ?? 0) + 1);
  const movedAway = new Set(input.attendees.filter((a) => a.source === "transferred" && a.fromEventId).map((a) => `${a.fromEventId}:${a.memberId}`));
  const markOf = new Map(input.notAttending.map((m) => [`${m.eventId}:${m.memberId}`, m]));

  const verdictBlocks: Block[] = [];
  for (const eventId of eventIds) {
    const eventBlocks = blocks.filter((b) => b.eventId === eventId);
    const memberIds = new Set([...input.attendees.filter((a) => a.eventId === eventId).map((a) => a.memberId), ...eventBlocks.map((b) => b.memberId)]);
    for (const memberId of memberIds) {
      if (!memberById.has(memberId)) continue;
      const mine = eventBlocks.filter((b) => b.memberId === memberId);
      const attendee = attendeeOf(memberId, eventId);
      const payments = mine.flatMap((b) => b.payments);
      const paid = payments.some((t) => t.keptCents > 0);
      const anyPayment = payments.some((t) => t.invoiceStatus === "paid" && t.billedCents > 0);
      const verdict = (status: RowStatus, reason: string, needsAttention: boolean) => {
        const target = mine[0] ?? { memberId, type: "event" as PurchaseType, eventId, purchase: null, offer: null, subscription: null, payments: [], rows: [] };
        target.rows.push({ expectedDate: null, expectedAmountCents: null, month: input.today.slice(0, 7), currency: "usd", status, reason, needsAttention, cause: "event", transactions: [] });
        if (!mine[0]) verdictBlocks.push(target);
      };
      const refundedAll = anyPayment && !paid;
      if (attendee && attendee.source === null) {
        if (!mine.some((b) => b.purchase) && payments.length === 0) verdict("missing_payment", "On the attendee list as a ticket they bought, but there is no Kajabi purchase or Stripe payment for this event.", true);
        else if (refundedAll) verdict("missing_payment", "Everything paid for this event was refunded, but they are still on the attendee list as a ticket they bought.", true);
      } else if (attendee) {
        const label = attendee.source === "comped" ? "comped" : attendee.source === "gifted" ? "gifted" : "transferred";
        if (paid) verdict("unexplained_payment", `Recorded as a ${label} ticket, which expects no payment here, but Stripe shows a payment.`, true);
        else if (mine.length === 0) verdict(attendee.source as RowStatus, attendee.source === "transferred" ? "Transferred from another event: its payment belongs to the origin event." : `A ${label} ticket: no payment is expected.`, false);
      } else if (anyPayment || paid) {
        const mark = markOf.get(`${eventId}:${memberId}`);
        const tickets = mine.filter((b) => b.purchase && b.purchase.deactivatedAt === null).length;
        if (refundedAll) {
          // Paid and refunded: nothing is owed, nothing to explain.
        } else if (mark) verdict(mark.reason === "forfeited" ? "forfeited" : "marked_not_attending", mark.reason === "forfeited" ? "Paid, not attending, and marked forfeited." : `Paid, not attending, marked: ${mark.note ?? "other"}.`, false);
        else if (tickets > 0 && (receivers.get(`${eventId}:${memberId}`) ?? 0) >= tickets) verdict("gifted", "Paid and not attending: every ticket went to a gifted attendee.", false);
        else if (movedAway.has(`${eventId}:${memberId}`)) verdict("transferred", "Paid and not attending: the ticket was moved to another event.", false);
        else verdict("unexplained_payment", "Paid for this event but not on the attendee list, and not marked forfeited, gifted or transferred.", true);
      }
    }
  }
  blocks.push(...verdictBlocks);

  // ---- assemble the schedules.
  const schedules: PurchaseSchedule[] = [];
  const seen = new Map<string, number>();
  for (const block of blocks) {
    if (block.rows.length === 0) continue;
    const event = block.eventId ? eventById.get(block.eventId) : undefined;
    const purchase = block.purchase;
    const offerName = block.offer?.name ?? event?.title ?? "Purchase";
    const base = `${block.memberId}:${block.type}:${block.eventId ?? block.offer?.offerId ?? "none"}:${purchase?.purchaseId ?? "none"}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    const rows = block.rows
      .map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.expectedDate ?? a.r.transactions[0]?.day ?? "9999").localeCompare(b.r.expectedDate ?? b.r.transactions[0]?.day ?? "9999") || a.i - b.i)
      .map(({ r }, i): ScheduleRow => ({ ...r, key: `${base}${n === 1 ? "" : `:${n}`}:${i + 1}` }));
    const days = block.payments.map((t) => t.day).sort();
    const plan = purchase?.paymentType === "multipay" || purchase?.paymentType === "subscription";
    schedules.push({
      purchaseType: block.type,
      label: event ? event.title : offerName,
      memberId: block.memberId,
      key: `${base}${n === 1 ? "" : `:${n}`}`,
      start: purchase ? dayOf(purchase) : (days[0] ?? null),
      end: null,
      rows,
      notes: purchase ? [] : ["No Kajabi purchase is on record for these payments."],
      event: event ? { id: event.id, slug: event.slug, title: event.title } : undefined,
      purchase: purchase
        ? {
            purchaseId: purchase.purchaseId,
            offerName,
            priceText: block.offer?.priceText ?? null,
            day: dayOf(purchase),
            amountCents: purchase.amountCents,
            quantity: purchase.quantity,
            granted: purchase.amountCents === 0,
            status: purchase.deactivatedAt ? "canceled" : plan ? (block.subscription?.status === "canceled" ? "canceled" : "active") : "active",
          }
        : undefined,
    });
  }
  return schedules.sort((a, b) => a.memberId.localeCompare(b.memberId) || (b.start ?? "").localeCompare(a.start ?? "") || (a.key ?? "").localeCompare(b.key ?? ""));
}
