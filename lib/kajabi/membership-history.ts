import { isMembershipOffer } from "@/lib/membership";

export type MembershipPurchase = {
  created_at_kajabi: string;
  deactivated_at: string | null;
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
    .order("effective_start_at", { ascending: false });

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

  return purchases.filter((p: any) => membershipOfferIds.has(p.kajabi_offer_id));
}
