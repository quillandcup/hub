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

// A Stripe subscription's real conversion date, keyed by Kajabi customer ID.
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

// A purchase counts as a real membership stint if it's a Quill & Cup
// membership subscription AND it wasn't cancelled during its trial window
// (a trial that never converted was never actually a member — same
// distinction app/api/process/members/route.ts's status classification
// already makes via trialEndDate, just applied per-purchase here so a
// trial-only lead never gets a first_joined_at / shows up in "Membership
// History").
function isRealMembershipStint(purchase: RawPurchase, offer: OfferInfo | undefined): boolean {
  if (offer?.data?.attributes?.subscription !== true) return false;
  if (!isMembershipOffer(offer.name || "")) return false;
  const trialEnd = trialEndDate(purchase, offer);
  if (!trialEnd) return true; // no trial at all — billed from day one
  if (!purchase.deactivated_at) return true; // still active — already past/within a converting trial
  return new Date(purchase.deactivated_at) > trialEnd; // survived past the trial window = was actually billed
}

const TRIAL_MATCH_TOLERANCE_MS = 5 * 60 * 1000;

// Kajabi's created_at_kajabi is when the subscription/trial was *created* —
// but the join date this app has always tracked is the first real
// transaction, which for a trialed signup happens when the trial converts,
// days later. Find the Stripe subscription created around the same instant
// as this purchase (they're created within seconds of each other in
// practice) and, if it shows a real trial, use its trial-end date instead.
function resolveJoinDate(
  rawDate: string,
  customerId: string | undefined,
  stripeInfoByCustomerId: Map<string, StripeTrialInfo[]> | undefined
): string {
  const candidates = customerId ? stripeInfoByCustomerId?.get(customerId) : undefined;
  if (!candidates || candidates.length === 0) return rawDate;

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

  return best && bestDiffMs <= TRIAL_MATCH_TOLERANCE_MS && best.trialEnd ? best.trialEnd : rawDate;
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
  stripeInfoByKajabiCustomerId?: Map<string, StripeTrialInfo[]>
): MembershipPurchase[] {
  const membership = purchases.filter((p) => isRealMembershipStint(p, offerMap.get(p.kajabi_offer_id)));

  // End date is each purchase's own deactivated_at (null = still active). Chaining to the
  // next purchase's created_at_kajabi would hide real cancel/resubscribe gaps.
  // created_at_kajabi is nullable at the DB level — fall back to effective_start_at
  // and drop any purchase with neither, since it can't be placed in time at all.
  return membership
    .map((p) => {
      const rawDate = p.created_at_kajabi ?? p.effective_start_at ?? null;
      return {
        created_at_kajabi: rawDate
          ? resolveJoinDate(rawDate, p.kajabi_customer_id, stripeInfoByKajabiCustomerId)
          : null,
        derived_end_at: p.deactivated_at,
        status: p.status,
        kajabi_offer_id: p.kajabi_offer_id,
      };
    })
    .filter((p): p is MembershipPurchase => p.created_at_kajabi !== null)
    .sort((a, b) => a.created_at_kajabi.localeCompare(b.created_at_kajabi));
}

// Fetches Stripe subscriptions' real conversion dates for a set of Kajabi
// customer IDs. Links via stripe_customers.data.metadata.kjb_member_id — a
// direct ID Kajabi's own Stripe integration writes back — rather than email,
// which can differ or alias across the two systems.
export async function fetchStripeTrialInfoByKajabiCustomerId(
  supabase: any,
  kajabiCustomerIds: string[]
): Promise<Map<string, StripeTrialInfo[]>> {
  const result = new Map<string, StripeTrialInfo[]>();
  if (kajabiCustomerIds.length === 0) return result;

  const kajabiCustomerIdSet = new Set(kajabiCustomerIds);
  const stripeCustomers = await fetchAllBronzeRows(supabase, "stripe_customers", "stripe_customer_id, data");

  const stripeCustomerIdByKajabiCustomerId = new Map<string, string>();
  for (const c of stripeCustomers) {
    const kajabiCustomerId = c.data?.metadata?.kjb_member_id;
    if (kajabiCustomerId && kajabiCustomerIdSet.has(kajabiCustomerId)) {
      stripeCustomerIdByKajabiCustomerId.set(kajabiCustomerId, c.stripe_customer_id);
    }
  }
  if (stripeCustomerIdByKajabiCustomerId.size === 0) return result;

  const stripeCustomerIds = [...new Set(stripeCustomerIdByKajabiCustomerId.values())];
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

  for (const [kajabiCustomerId, stripeCustomerId] of stripeCustomerIdByKajabiCustomerId) {
    const subs = subscriptionsByStripeCustomerId.get(stripeCustomerId);
    if (subs) result.set(kajabiCustomerId, subs);
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

  const stripeInfoByKajabiCustomerId = await fetchStripeTrialInfoByKajabiCustomerId(supabase, customerIds);

  return buildMembershipStints(purchases, offerMap, stripeInfoByKajabiCustomerId).reverse();
}
