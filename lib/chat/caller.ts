import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";

export interface ChatCaller {
  userId: string;
  identity: EffectiveIdentity;
}

/**
 * Who is calling a chat action: the signed-in member with chat on, or null (signed out, no member
 * record, chat off). Actions are directly callable endpoints, so each one checks for itself rather
 * than trusting the page that offers it; unlike the pages they answer "nothing" instead of redirecting.
 */
export async function chatCaller(): Promise<ChatCaller | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  // Neither needs the other's answer, so ask together.
  const [identity, ownFeatures] = await Promise.all([getEffectiveIdentity(user), getUserFeaturePreviews(user.id)]);
  if (!identity) return null;
  if (!(await effectiveMemberHasFeature("chat", identity, ownFeatures))) return null;
  return { userId: user.id, identity };
}

/** Posting is its own preview on top of chat, and never happens in sudo (read-only). */
export async function postingCaller(): Promise<ChatCaller | null> {
  const caller = await chatCaller();
  if (!caller || caller.identity.isSudo) return null;
  if (!(await effectiveMemberHasFeature("chat_posting", caller.identity, await getUserFeaturePreviews(caller.userId)))) return null;
  return caller;
}
