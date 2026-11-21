import { headers } from "next/headers";
import { eventsNeedConsent } from "@/lib/analytics/consent";
import { isAnalyticsOptedOut } from "@/lib/analytics/opt-out";
import type { MuxDataConsent } from "@/lib/mux-data";

/**
 * The consent facts the player needs to start Mux Data for this viewer; null in sudo, where Mux Data never runs (an
 * admin's own IP and browser would be reported as the member's view). Mux Data collects the viewer's IP address and user
 * agent by nature, so it follows the Hub's usage-statistics consent (the banner and the "Share usage statistics"
 * switch), not the first-party course data: the player still waits for the banner's Accept where one is needed and
 * never starts after "Leave me out of statistics".
 */
export async function muxDataConsentFor(userId: string, identity: { isSudo: boolean }): Promise<MuxDataConsent | null> {
  if (identity.isSudo) return null;
  const [headerList, optedOut] = await Promise.all([headers(), isAnalyticsOptedOut(userId)]);
  return { needsConsent: eventsNeedConsent(headerList.get("x-vercel-ip-country")), optedOut };
}
