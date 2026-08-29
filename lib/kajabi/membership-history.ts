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

// Filters purchases down to real membership-subscription stints and derives
// each one's end date. Ascending by created_at_kajabi. This is the single
// definition of "what counts as a membership stint" — shared by the
// "Membership History" display (fetchMembershipHistory below), the
// resubscription gap labels (lib/resubscription-detection.ts), and member
// tenure calculations (lib/member-tenure.ts) — so those can't silently
// disagree on what a stint is.
export function buildMembershipStints(
  purchases: RawPurchase[],
  offerMap: Map<string, OfferInfo>
): MembershipPurchase[] {
  const membership = purchases.filter((p) => isRealMembershipStint(p, offerMap.get(p.kajabi_offer_id)));

  // End date is each purchase's own deactivated_at (null = still active). Chaining to the
  // next purchase's created_at_kajabi would hide real cancel/resubscribe gaps.
  // created_at_kajabi is nullable at the DB level — fall back to effective_start_at
  // and drop any purchase with neither, since it can't be placed in time at all.
  return membership
    .map((p) => ({
      created_at_kajabi: p.created_at_kajabi ?? p.effective_start_at ?? null,
      derived_end_at: p.deactivated_at,
      status: p.status,
      kajabi_offer_id: p.kajabi_offer_id,
    }))
    .filter((p): p is MembershipPurchase => p.created_at_kajabi !== null)
    .sort((a, b) => a.created_at_kajabi.localeCompare(b.created_at_kajabi));
}

export async function fetchMembershipHistory(
  supabase: any,
  customerIds: string[]
): Promise<MembershipPurchase[]> {
  if (customerIds.length === 0) return [];

  const { data: purchases } = await supabase
    .schema("bronze")
    .from("kajabi_purchases")
    .select("created_at_kajabi, effective_start_at, deactivated_at, status, kajabi_offer_id")
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

  return buildMembershipStints(purchases, offerMap).reverse();
}
