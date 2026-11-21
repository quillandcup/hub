import type { Repos } from "@/lib/data/repos";

// A member's trial length is not a setting anywhere: Kajabi's offers don't expose it
// (trial_period_days is always null), but each Stripe subscription that had a trial carries
// data.trial_start and data.trial_end (unix seconds). Read those so a 7-day trial and a
// month-long one are each treated as what they were.

export interface TrialWindow {
  /** YYYY-MM-DD */
  start: string;
  end: string;
}

/** How far a Stripe trial's start may be from the date entered for a match and still be that trial. */
const START_TOLERANCE_DAYS = 7;

const MS_PER_DAY = 86_400_000;

function day(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/** The trial window of one Stripe subscription's `data`, or null if it had no trial. */
export function trialWindowFromSubscription(data: unknown): TrialWindow | null {
  const d = data as { trial_start?: unknown; trial_end?: unknown } | null;
  if (!d || typeof d.trial_start !== "number" || typeof d.trial_end !== "number") return null;
  if (d.trial_end <= d.trial_start) return null;
  return { start: day(d.trial_start), end: day(d.trial_end) };
}

/** The window belonging to a match whose trial began on `trialStartedOn`: the closest start
 * within tolerance (someone may have trialed more than once). */
export function pickTrialWindow(windows: TrialWindow[], trialStartedOn: string): TrialWindow | null {
  const target = Date.parse(`${trialStartedOn}T00:00:00Z`);
  let best: TrialWindow | null = null;
  let bestDiff = Infinity;
  for (const w of windows) {
    const diff = Math.abs(Date.parse(`${w.start}T00:00:00Z`) - target);
    if (diff <= START_TOLERANCE_DAYS * MS_PER_DAY && diff < bestDiff) {
      best = w;
      bestDiff = diff;
    }
  }
  return best;
}

/** Every Stripe trial window for each member, found by the member's email and its aliases.
 * Pass the members you need only: it is one lookup per batch, not a scan of all subscriptions. */
export async function fetchTrialWindows(
  repos: Pick<Repos, "aliases" | "billing">,
  members: { id: string; email: string }[]
): Promise<Map<string, TrialWindow[]>> {
  const result = new Map<string, TrialWindow[]>();
  if (members.length === 0) return result;

  const memberIds = members.map((m) => m.id);
  const aliasRows = await repos.aliases.emailsOfMembers(memberIds);

  const memberByEmail = new Map<string, string>();
  for (const m of members) memberByEmail.set(m.email.toLowerCase(), m.id);
  for (const a of aliasRows) {
    memberByEmail.set(a.alias_email.toLowerCase(), a.member_id);
  }

  const emails = [...memberByEmail.keys()];
  const billing = repos.billing;
  const customers = await billing.stripeCustomers({ emails });
  const memberByCustomer = new Map<string, string>();
  for (const c of customers) {
    const memberId = c.email ? memberByEmail.get(c.email.toLowerCase()) : undefined;
    if (memberId) memberByCustomer.set(c.stripe_customer_id, memberId);
  }
  if (memberByCustomer.size === 0) return result;

  const subscriptions = await billing.stripeSubscriptionsByCustomers([...memberByCustomer.keys()]);
  for (const s of subscriptions) {
    const window = trialWindowFromSubscription(s.data);
    const memberId = memberByCustomer.get(s.stripe_customer_id);
    if (!window || !memberId) continue;
    const list = result.get(memberId) ?? [];
    list.push(window);
    result.set(memberId, list);
  }
  return result;
}
