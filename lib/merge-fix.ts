export interface EnrichedMember {
  id: string;
  name: string;
  email: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_active: boolean;
}

export interface EnrichedGroup {
  reason: string;
  members: EnrichedMember[];
}

/**
 * Sorts group members so the best primary candidate is first.
 * Priority: active Kajabi status → active Stripe subscription → has Stripe record
 */
export function sortGroupMembers(members: EnrichedMember[]): EnrichedMember[] {
  return [...members].sort((a, b) => {
    const aActive = a.status === "active";
    const bActive = b.status === "active";
    if (aActive !== bActive) return aActive ? -1 : 1;

    if (a.stripe_active !== b.stripe_active) return a.stripe_active ? -1 : 1;

    const aHasStripe = !!a.stripe_customer_id;
    const bHasStripe = !!b.stripe_customer_id;
    if (aHasStripe !== bHasStripe) return aHasStripe ? -1 : 1;

    return 0;
  });
}
