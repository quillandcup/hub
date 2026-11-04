import { headers } from "next/headers";
import { eventsNeedConsent } from "@/lib/analytics/consent";
import { isAnalyticsOptedOut } from "@/lib/analytics/opt-out";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import type { MuxDataConsent } from "@/lib/mux-data";

/**
 * Whether the lesson page should offer Mux Data for this viewer, and the consent facts the browser needs; null for no
 * Mux Data at all. Mux Data collects the viewer's IP address and user agent by nature, so it follows the Hub's
 * usage-statistics consent (the banner and the "Share usage statistics" switch), not the first-party course data. It is
 * off unless the `mux_data` flag is on for the viewer, and never in sudo (an admin's own IP and browser would be
 * reported as the member's view).
 */
export async function muxDataConsentFor(userId: string, identity: { memberId: string; isSudo: boolean }): Promise<MuxDataConsent | null> {
  if (identity.isSudo) return null;
  const own = await getUserFeaturePreviews(userId);
  if (!(await effectiveMemberHasFeature("mux_data", identity, own))) return null;
  const [headerList, optedOut] = await Promise.all([headers(), isAnalyticsOptedOut(userId)]);
  return { needsConsent: eventsNeedConsent(headerList.get("x-vercel-ip-country")), optedOut };
}
