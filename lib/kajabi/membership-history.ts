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

  // Derive end date: use next subscription's billing start, fall back to deactivated_at for the most recent
  const withDerivedEnds: MembershipPurchase[] = membership.map((p: any, i: number) => ({
    created_at_kajabi: p.created_at_kajabi,
    derived_end_at: i < membership.length - 1 ? membership[i + 1].created_at_kajabi : p.deactivated_at,
    status: p.status,
    kajabi_offer_id: p.kajabi_offer_id,
  }));

  return withDerivedEnds.reverse();
}
