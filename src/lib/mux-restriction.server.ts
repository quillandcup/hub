import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";
import { playbackRestrictionId } from "@/lib/mux";

/**
 * The restriction id to put on this viewer's video token, or null for none. Enforcement is on only when
 * the `mux_playback_restriction` flag is on for the effective viewer (the sudo'd member in sudo, like
 * other member features) AND `MUX_PLAYBACK_RESTRICTION_ID` is set for this Mux environment. The env var
 * is checked first, so nothing is looked up where it isn't set.
 */
export async function restrictionIdForViewer(
  userId: string,
  identity: { memberId: string; isSudo: boolean } | null,
): Promise<string | null> {
  const id = playbackRestrictionId();
  if (!id) return null;
  const own = await getUserFeaturePreviews(userId);
  const on = identity
    ? await effectiveMemberHasFeature("mux_playback_restriction", identity, own)
    : own.includes("mux_playback_restriction");
  return on ? id : null;
}
