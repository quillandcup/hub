import { isMembershipOffer } from "@/lib/membership";

export type MembershipPurchase = {
  created_at_kajabi: string;
  derived_end_at: string | null;
  status: string;
  kajabi_offer_id: string;
};

export async function fetchMembershipHistory(
  supabase: any,
  customerIds: string[]
): Promise<MembershipPurchase[]> {
  if (customerIds.length === 0) return [];

  const { data: purchases } = await supabase
    .schema("bronze")
    .from("kajabi_purchases")
    .select("created_at_kajabi, deactivated_at, status, kajabi_offer_id")
    .in("kajabi_customer_id", customerIds)
    .order("created_at_kajabi", { ascending: true });

  if (!purchases || purchases.length === 0) return [];

  const offerIds = [...new Set(purchases.map((p: any) => p.kajabi_offer_id).filter(Boolean))];
  if (offerIds.length === 0) return [];

  const { data: offers } = await supabase
    .schema("bronze")
    .from("kajabi_offers")
    .select("kajabi_offer_id, name, data")
    .in("kajabi_offer_id", offerIds);

  const membershipOfferIds = new Set(
    (offers || [])
      .filter((o: any) => o.data?.attributes?.subscription === true && isMembershipOffer(o.name || ""))
      .map((o: any) => o.kajabi_offer_id)
  );

  // Filter to membership purchases (already sorted ascending by created_at_kajabi)
  const membership = purchases.filter((p: any) => membershipOfferIds.has(p.kajabi_offer_id));

  // End date is each purchase's own deactivated_at (null = still active). Chaining to the
  // next purchase's created_at_kajabi would hide real cancel/resubscribe gaps.
  const withDerivedEnds: MembershipPurchase[] = membership.map((p: any) => ({
    created_at_kajabi: p.created_at_kajabi,
    derived_end_at: p.deactivated_at,
    status: p.status,
    kajabi_offer_id: p.kajabi_offer_id,
  }));

  return withDerivedEnds.reverse();
}
