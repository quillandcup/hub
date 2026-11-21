import type { FeatureKey } from "@/lib/features";

/**
 * Whether the signed-in member may start a direct message: never in sudo (read-only), and only with the
 * Slack DM bridge or Hub direct messages on for them. One rule for the profile's Message button and the
 * chat sidebar's New message picker. `ownFeatures` is `getUserFeaturePreviews`/the member's own flags.
 */
export function canStartDirectMessage(identity: { isSudo: boolean }, ownFeatures: FeatureKey[]): boolean {
  if (identity.isSudo) return false;
  return ownFeatures.includes("slack_dm_bridge") || ownFeatures.includes("chat_dms");
}
