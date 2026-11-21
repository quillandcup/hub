import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";

export interface ChatCaller {
  userId: string;
  identity: EffectiveIdentity;
}

/**
 * Who is calling a chat action: the signed-in member, or null (signed out, no member record).
 * Actions are directly callable endpoints, so each one checks for itself rather than trusting the
 * page that offers it; unlike the pages they answer "nothing" instead of redirecting.
 */
export async function chatCaller(): Promise<ChatCaller | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const identity = await getEffectiveIdentity(user);
  if (!identity) return null;
  return { userId: user.id, identity };
}

/** Posting never happens in sudo (read-only). */
export async function postingCaller(): Promise<ChatCaller | null> {
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return null;
  return caller;
}

/** Starting a Hub direct message is its own preview on top of posting. (Replying to one you were sent only needs posting.) */
export async function dmCaller(): Promise<ChatCaller | null> {
  const caller = await postingCaller();
  if (!caller) return null;
  if (!(await effectiveMemberHasFeature("chat_dms", caller.identity, await getUserFeaturePreviews(caller.userId)))) return null;
  return caller;
}
