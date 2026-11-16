/**
 * Which Stripe customer a member is linked to (`members.stripe_customer_id`) when several Stripe
 * customers resolve to one email. A checkout for a course or retreat can create a second customer
 * for someone who already has one, and the newer one holds no subscription, so "the last one wins"
 * linked members to a customer with nothing on it while the live membership sat on the older one.
 */

export interface LinkableStripeCustomer {
  stripe_customer_id: string;
  email: string | null;
  created_at_stripe: string | null;
}

export interface LinkableStripeSubscription {
  stripe_customer_id: string;
  status: string;
}

/** Statuses of a subscription that still bills or is about to. Any product counts. */
export const LIVE_STRIPE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing", "past_due"]);

function rank(c: LinkableStripeCustomer, live: Set<string>, any: Set<string>): number {
  if (live.has(c.stripe_customer_id)) return 2;
  if (any.has(c.stripe_customer_id)) return 1;
  return 0;
}

/** True when `a` should be linked in preference to `b`. Independent of input order. */
function better(a: LinkableStripeCustomer, b: LinkableStripeCustomer, live: Set<string>, any: Set<string>): boolean {
  const ra = rank(a, live, any);
  const rb = rank(b, live, any);
  if (ra !== rb) return ra > rb;
  const ca = a.created_at_stripe ?? "";
  const cb = b.created_at_stripe ?? "";
  if (ca !== cb) return ca > cb;
  return a.stripe_customer_id > b.stripe_customer_id;
}

/**
 * The customer id to link per resolved email: one holding a live subscription, else one with any
 * subscription, else the most recently created. `resolveEmail` maps an email to its canonical one.
 */
export function pickStripeCustomerByEmail(
  customers: LinkableStripeCustomer[],
  subscriptions: LinkableStripeSubscription[],
  resolveEmail: (email: string) => string
): Map<string, string> {
  const live = new Set<string>();
  const any = new Set<string>();
  for (const s of subscriptions) {
    any.add(s.stripe_customer_id);
    if (LIVE_STRIPE_STATUSES.has(s.status)) live.add(s.stripe_customer_id);
  }
  const best = new Map<string, LinkableStripeCustomer>();
  for (const c of customers) {
    if (!c.email || !c.stripe_customer_id) continue;
    const email = resolveEmail(c.email);
    const current = best.get(email);
    if (!current || better(c, current, live, any)) best.set(email, c);
  }
  return new Map(Array.from(best, ([email, c]) => [email, c.stripe_customer_id]));
}
