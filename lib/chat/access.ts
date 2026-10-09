import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, type AuthUser } from "@/lib/auth";
import { getEffectiveIdentity, type EffectiveIdentity } from "@/lib/sudo";
import { effectiveMemberHasFeature, getUserFeaturePreviews } from "@/lib/features.server";

/**
 * The gate every chat page (and the chat layout) starts with: signed in, has a member record
 * (the sudo'd member's, in sudo), and the `chat` feature is on for that member. Sudo follows the
 * viewed member's flag, like the notifications inbox. Memoized per render.
 */
export const requireChat = cache(async (): Promise<{ user: AuthUser; identity: EffectiveIdentity }> => {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const identity = await getEffectiveIdentity(user);
  if (!identity) redirect("/admin");
  const ownFeatures = await getUserFeaturePreviews(user.id);
  if (!(await effectiveMemberHasFeature("chat", identity, ownFeatures))) notFound();
  return { user, identity };
});
