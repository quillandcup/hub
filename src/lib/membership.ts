export const MEMBERSHIP_PRODUCT_NAMES = [
  "Quill & Cup Membership",
  "Yes, girl! I see you!",
] as const;

export function isMembershipOffer(offerName: string): boolean {
  return MEMBERSHIP_PRODUCT_NAMES.some(n => offerName.includes(n)) || offerName.includes('Membership');
}

// The end of a purchase's trial window, or null if the offer has no trial
// (or the purchase is missing the start date needed to compute it).
export function trialEndDate(
  purchase: { effective_start_at?: string | null },
  offer: { trial_period_days?: number | null } | undefined
): Date | null {
  const trialDays = offer?.trial_period_days ?? 0;
  if (trialDays <= 0 || !purchase.effective_start_at) return null;
  const end = new Date(purchase.effective_start_at);
  end.setDate(end.getDate() + trialDays);
  return end;
}
