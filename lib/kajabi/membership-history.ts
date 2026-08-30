import { isMembershipOffer, trialEndDate } from "@/lib/membership";

export type MembershipPurchase = {
  created_at_kajabi: string;
  derived_end_at: string | null;
  status: string;
  kajabi_offer_id: string;
};

type RawPurchase = {
  created_at_kajabi: string | null;
  effective_start_at?: string | null;
  deactivated_at: string | null;
  status: string;
  kajabi_offer_id: string;
  kajabi_customer_id?: string;
};

// A Stripe subscription's real conversion date, keyed by the member's
// canonical email (not Kajabi customer ID — when Kajabi merges two contacts,
// the surviving purchase gets reassigned to the new customer ID, but the old
// Stripe customer's metadata still points at the now-orphaned old ID, so a
// customer-ID-keyed lookup silently loses that history. Email survives the
// merge because both the old and new Stripe customers still carry their own
// real email, and member_email_aliases links them to one canonical email).
// trialEnd is set ONLY when the subscription actually shows a trial_start +
// trial_end pair — billing_cycle_anchor alone isn't trustworthy as a join
// date since it can be reset later by plan changes/pauses unrelated to
// onboarding (confirmed against production data: every subscription with a
// real trial has anchor == trial_end, but ~3% of non-trial subscriptions
// have an anchor that drifted years from their creation date).
export type StripeTrialInfo = {
  createdAtStripe: string;
  trialEnd: string | null;
};

type OfferInfo = {
  name?: string | null;
  data?: { attributes?: { subscription?: boolean } };
  trial_period_days?: number | null;
};

const TRIAL_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

// Finds the Stripe subscription created around the same instant as a Kajabi
// purchase (they're created within seconds of each other in practice).
function findMatchingStripeInfo(
  rawDate: string,
  canonicalEmail: string | undefined,
  stripeInfoByEmail: Map<string, StripeTrialInfo[]> | undefined
): StripeTrialInfo | null {
  const candidates = canonicalEmail ? stripeInfoByEmail?.get(canonicalEmail) : undefined;
  if (!candidates || candidates.length === 0) return null;

  const rawMs = new Date(rawDate).getTime();
  let best: StripeTrialInfo | null = null;
  let bestDiffMs = Infinity;
  for (const candidate of candidates) {
    const diffMs = Math.abs(new Date(candidate.createdAtStripe).getTime() - rawMs);
    if (diffMs < bestDiffMs) {
      bestDiffMs = diffMs;
      best = candidate;
    }
  }

  return best && bestDiffMs <= TRIAL_MATCH_TOLERANCE_MS ? best : null;
}

// A purchase counts as a real membership stint if it's a Quill & Cup
// membership subscription AND it wasn't cancelled during its trial window
// (a trial that never converted was never actually a member — same
// distinction app/api/process/members/route.ts's status classification
// makes, via this same function, so a trial-only lead never gets a
// first_joined_at / shows up in "Membership History").
//
// Trial detection prefers the matching Stripe subscription's real
// trial_start/trial_end over the Kajabi offer's trial_period_days: Kajabi's
// API doesn't expose trial terms on the offer object at all (confirmed
// always null against production data), so relying on it alone means every
// purchase looks "billed from day one" — even ones that were pure trials,
// never converted, and never charged.
export function isRealMembershipStint(
  purchase: RawPurchase,
  offer: OfferInfo | undefined,
  canonicalEmail?: string,
  stripeInfoByEmail?: Map<string, StripeTrialInfo[]>
): boolean {
  if (offer?.data?.attributes?.subscription !== true) return false;
  if (!isMembershipOffer(offer.name || "")) return false;
  const rawDate = purchase.created_at_kajabi ?? purchase.effective_start_at ?? null;
  const matched = rawDate ? findMatchingStripeInfo(rawDate, canonicalEmail, stripeInfoByEmail) : null;
  const trialEnd = matched?.trialEnd ? new Date(matched.trialEnd) : trialEndDate(purchase, offer);
  if (!trialEnd) return true; // no trial at all — billed from day one
  if (!purchase.deactivated_at) return true; // still active — already past/within a converting trial
  return new Date(purchase.deactivated_at) > trialEnd; // survived past the trial window = was actually billed
}

// Kajabi's created_at_kajabi is when the subscription/trial was *created* —
// but the join date this app has always tracked is the first real
// transaction, which for a trialed signup happens when the trial converts,
// days later. Use the matching Stripe subscription's trial-end date when it
// shows a real trial.
function resolveJoinDate(
  rawDate: string,
  canonicalEmail: string | undefined,
  stripeInfoByEmail: Map<string, StripeTrialInfo[]> | undefined
): string {
  const matched = findMatchingStripeInfo(rawDate, canonicalEmail, stripeInfoByEmail);
  return matched?.trialEnd ?? rawDate;
}

// Filters purchases down to real membership-subscription stints and derives
// each one's end date. Ascending by created_at_kajabi. This is the single
// definition of "what counts as a membership stint" — shared by the
// "Membership History" display (fetchMembershipHistory below), the
// resubscription gap labels (lib/resubscription-detection.ts), and member
// tenure calculations (lib/member-tenure.ts) — so those can't silently
// disagree on what a stint is.
export function buildMembershipStints(
  purchases: RawPurchase[],
  offerMap: Map<string, OfferInfo>,
  canonicalEmail?: string,
  stripeInfoByEmail?: Map<string, StripeTrialInfo[]>
): MembershipPurchase[] {
  const membership = purchases.filter((p) =>
    isRealMembershipStint(p, offerMap.get(p.kajabi_offer_id), canonicalEmail, stripeInfoByEmail)
  );

  // End date is each purchase's own deactivated_at (null = still active). Chaining to the
  // next purchase's created_at_kajabi would hide real cancel/resubscribe gaps.
  // created_at_kajabi is nullable at the DB level — fall back to effective_start_at
  // and drop any purchase with neither, since it can't be placed in time at all.
  return membership
    .map((p) => {
      const rawDate = p.created_at_kajabi ?? p.effective_start_at ?? null;
      return {
        created_at_kajabi: rawDate ? resolveJoinDate(rawDate, canonicalEmail, stripeInfoByEmail) : null,
        derived_end_at: p.deactivated_at,
        status: p.status,
        kajabi_offer_id: p.kajabi_offer_id,
      };
    })
    .filter((p): p is MembershipPurchase => p.created_at_kajabi !== null)
    .sort((a, b) => a.created_at_kajabi.localeCompare(b.created_at_kajabi));
}

// Fetches Stripe subscriptions' real conversion dates, keyed by canonical
// email. Matches Stripe customers by their own email column (set at import
// time from the Stripe API) rather than stripe_customers.data.metadata.
// kjb_member_id: that metadata is written once at Stripe-customer-creation
// time and never updated, so after a Kajabi-side contact merge it still
// points at the old, orphaned Kajabi customer ID. Email survives the merge
// and, combined with member_email_aliases, correctly groups a merged
// person's old AND new Stripe subscriptions under one canonical email.
export async function fetchStripeTrialInfoByEmail(
  supabase: any,
  emailAliases: { alias_email: string; canonical_email: string }[]
): Promise<Map<string, StripeTrialInfo[]>> {
  const result = new Map<string, StripeTrialInfo[]>();

  const aliasMap = new Map<string, string>();
  for (const a of emailAliases) {
    aliasMap.set(a.alias_email.toLowerCase(), a.canonical_email.toLowerCase());
  }
  const resolveEmail = (email: string) => aliasMap.get(email.toLowerCase()) ?? email.toLowerCase();

  const stripeCustomers = await fetchAllBronzeRows(supabase, "stripe_customers", "stripe_customer_id, email");
  if (stripeCustomers.length === 0) return result;

  const stripeCustomerIdsByCanonicalEmail = new Map<string, string[]>();
  for (const c of stripeCustomers) {
    if (!c.email) continue;
    const canonical = resolveEmail(c.email);
    const list = stripeCustomerIdsByCanonicalEmail.get(canonical) ?? [];
    list.push(c.stripe_customer_id);
    stripeCustomerIdsByCanonicalEmail.set(canonical, list);
  }

  const stripeCustomerIds = stripeCustomers.map((c) => c.stripe_customer_id);
  const stripeSubscriptions = await fetchAllBronzeRows(
    supabase,
    "stripe_subscriptions",
    "stripe_customer_id, created_at_stripe, data",
    (q) => q.in("stripe_customer_id", stripeCustomerIds)
  );

  const subscriptionsByStripeCustomerId = new Map<string, StripeTrialInfo[]>();
  for (const s of stripeSubscriptions) {
    const trialStart = s.data?.trial_start;
    const trialEnd = s.data?.trial_end;
    const list = subscriptionsByStripeCustomerId.get(s.stripe_customer_id) ?? [];
    list.push({
      createdAtStripe: s.created_at_stripe,
      trialEnd: trialStart && trialEnd ? new Date(trialEnd * 1000).toISOString() : null,
    });
    subscriptionsByStripeCustomerId.set(s.stripe_customer_id, list);
  }

  for (const [canonicalEmail, customerIds] of stripeCustomerIdsByCanonicalEmail) {
    const combined = customerIds.flatMap((id) => subscriptionsByStripeCustomerId.get(id) ?? []);
    if (combined.length > 0) result.set(canonicalEmail, combined);
  }

  return result;
}

// Paginates past Supabase's default 1000-row cap. See CLAUDE.md "Database
// Query Limits" — stripe_customers/stripe_subscriptions are small today but
// this keeps the fetch correct as they grow.
async function fetchAllBronzeRows(
  supabase: any,
  table: string,
  columns: string,
  filter?: (query: any) => any
): Promise<any[]> {
  const BATCH_SIZE = 1000;
  let allRows: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase.schema("bronze").from(table).select(columns);
    if (filter) query = filter(query);
    const { data: batch, error } = await query.range(offset, offset + BATCH_SIZE - 1);
    if (error) throw error;

    if (batch && batch.length > 0) {
      allRows = allRows.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allRows;
}

export async function fetchMembershipHistory(
  supabase: any,
  customerIds: string[]
): Promise<MembershipPurchase[]> {
  if (customerIds.length === 0) return [];

  const { data: purchases } = await supabase
    .schema("bronze")
    .from("kajabi_purchases")
    .select("created_at_kajabi, effective_start_at, deactivated_at, status, kajabi_offer_id, kajabi_customer_id")
    .in("kajabi_customer_id", customerIds)
    .order("created_at_kajabi", { ascending: true });

  if (!purchases || purchases.length === 0) return [];

  const offerIds = [...new Set(purchases.map((p: any) => p.kajabi_offer_id).filter(Boolean))];
  if (offerIds.length === 0) return [];

  const { data: offers } = await supabase
    .schema("bronze")
    .from("kajabi_offers")
    .select("kajabi_offer_id, name, data, trial_period_days")
    .in("kajabi_offer_id", offerIds);

  const offerMap = new Map<string, OfferInfo>(
    (offers || []).map((o: any) => [
      o.kajabi_offer_id,
      { name: o.name, data: o.data, trial_period_days: o.trial_period_days },
    ])
  );

  const { data: customers } = await supabase
    .schema("bronze")
    .from("kajabi_customers")
    .select("kajabi_customer_id, email")
    .in("kajabi_customer_id", customerIds);

  const { data: emailAliases } = await supabase
    .from("member_email_aliases")
    .select("alias_email, canonical_email");

  const aliasMap = new Map<string, string>();
  for (const a of emailAliases || []) {
    aliasMap.set(a.alias_email.toLowerCase(), a.canonical_email.toLowerCase());
  }
  const firstEmail = customers?.find((c: any) => c.email)?.email;
  const canonicalEmail = firstEmail
    ? aliasMap.get(firstEmail.toLowerCase()) ?? firstEmail.toLowerCase()
    : undefined;

  const stripeInfoByEmail = await fetchStripeTrialInfoByEmail(supabase, emailAliases || []);

  return buildMembershipStints(purchases, offerMap, canonicalEmail, stripeInfoByEmail).reverse();
}
