"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { withAction } from "@/lib/analytics/server";
import { isLevelAllowed, isProfileItem, isWebItem } from "@/lib/profile-visibility";
import { WRITER_PROFILES_NOT_AVAILABLE, memberHasWriterProfiles } from "@/lib/writer-profiles-access";
import { publishablePhotoUrl, writerProfilePath } from "@/lib/writer-profile";
import { copyGravatarPhoto, isGravatarAddress, memberPhotoStore } from "@/lib/members/photo";
import { createServiceRoleClient } from "@/lib/supabase/service";

const NO_PHOTO_FOR_THE_WEB = "There is no photo to show on the web yet. Upload one above, then choose the globe again.";

/**
 * The globe on the photo needs a photo that can be put on a public profile. Ours (uploaded, or a copy) always can. A Gravatar
 * picture cannot be shown from its own address, which carries a hash of the member's email, so choosing the globe for one is
 * the member's consent to copy it into our storage once; a member with no Gravatar has nothing to copy and is pointed to the
 * upload. Null when the photo can be shown, otherwise what to tell the member.
 */
async function ensurePublishablePhoto(memberId: string, userId: string, isSudo: boolean): Promise<string | null> {
  const service = getServiceRepos();
  const member = await service.members.byId(memberId);
  if (publishablePhotoUrl(member?.photoUrl) !== null) return null;
  if (!member || !isGravatarAddress(member.photoUrl)) return NO_PHOTO_FOR_THE_WEB;
  if (isSudo) return "Staff can look at a member's photo, but not copy it for them.";
  const copied = await copyGravatarPhoto(
    { members: service.members, memberStatus: service.memberStatus, store: memberPhotoStore(createServiceRoleClient()) },
    memberId,
    member.email,
    userId,
  );
  if (copied.ok) return null;
  return copied.reason === "none"
    ? "We couldn't find a Gravatar picture for your email, so there is no photo to show on the web. Upload one above, then choose the globe again."
    : "We couldn't copy your Gravatar picture just now. Try again, or upload a photo above.";
}

/**
 * Settings > Profile: who can see one item (the bio, the photo, a social link, the "Ask me about" topics), saved the moment
 * the member clicks the lock, house or globe (docs/product/WRITER_PROFILES.md, "Who sees what"). For the effective identity, so sudo
 * changes the member's own levels. The change is an audit entry as the member (a trigger on the table; never the text of the
 * item), and "no change" writes nothing.
 *
 * The globe is for the items the writer profile shows, and only for a member the `writer_profiles` flag is on for; the page itself
 * decides whether an item with the globe is shown (the page is on, and the flag is on for its owner).
 */
async function setProfileVisibilityImpl(item: string, level: string): Promise<{ success: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated" };
  const identity = await getEffectiveIdentity(user);
  if (!identity) return { error: "No member record" };

  if (!isProfileItem(item)) return { error: "That is not something on your profile." };
  if (!isLevelAllowed(item, level)) return { error: "That choice is not available for this item." };

  const memberId = identity.memberId;
  const repos = createRepos(await createClient());
  const service = getServiceRepos();

  if (level === "public") {
    if (!(await memberHasWriterProfiles(service, memberId))) return { error: WRITER_PROFILES_NOT_AVAILABLE };
    if (item === "photo") {
      const problem = await ensurePublishablePhoto(memberId, user.id, identity.isSudo);
      if (problem) return { error: problem };
    }
  }

  try {
    if (isWebItem(item)) {
      const current = (await repos.memberStatus.profileVisibilitiesOf(memberId))[item];
      if (current === level) return { success: true };
      await repos.memberStatus.saveProfileVisibility(memberId, item, level, user.id);
    } else {
      // "Ask me about" is never public (isLevelAllowed refused it above), so the level is private or community.
      const current = (await repos.memberProfile.askMeAboutOf(memberId)).visibility;
      if (current === level) return { success: true };
      await repos.memberProfile.saveAskMeAboutVisibility(memberId, level as "private" | "community", user.id);
    }
  } catch (error) {
    console.error("[profile] Saving who can see an item failed for member", memberId, error);
    return { error: "Couldn't save that — please try again." };
  }

  revalidatePath("/settings", "layout");
  revalidatePath("/members");
  revalidatePath(`/members/${memberId}`);
  if (isWebItem(item)) {
    const page = await repos.writerProfiles.ofMember(memberId).catch(() => null);
    if (page) revalidatePath(writerProfilePath(page.handle));
  }
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts), never which item or level.
export async function setProfileVisibility(...args: Parameters<typeof setProfileVisibilityImpl>): ReturnType<typeof setProfileVisibilityImpl> {
  return withAction("profile_visibility_set", () => setProfileVisibilityImpl(...args));
}
