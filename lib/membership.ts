export const MEMBERSHIP_PRODUCT_NAMES = [
  "Quill & Cup Membership",
  "Yes, girl! I see you!",
] as const;

export function isMembershipOffer(offerName: string): boolean {
  return MEMBERSHIP_PRODUCT_NAMES.some(n => offerName.includes(n)) || offerName.includes('Membership');
}
