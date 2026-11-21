"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getEffectiveIdentity } from "@/lib/sudo";
import { createRepos } from "@/lib/data/repos";
import { getServiceRepos } from "@/lib/data/server";
import { withAction } from "@/lib/analytics/server";
import { isLevelAllowed, isProfileItem, isWebItem } from "@/lib/profile-visibility";
import { WRITER_PAGES_NOT_AVAILABLE, memberHasWriterPages } from "@/lib/writer-pages-access";
import { publishablePhotoUrl, writerPagePath } from "@/lib/writer-profile";

/**
 * Settings > Profile: who can see one item (the bio, the photo, a social link, the "Ask me about" topics), saved the moment
 * the member clicks the lock, house or globe (docs/product/WRITER_PROFILES.md, "Who sees what"). For the effective identity, so sudo
 * changes the member's own levels. The change is an audit entry as the member (a trigger on the table; never the text of the
 * item), and "no change" writes nothing.
 *
 * The globe is for the items the writer page shows, and only for a member the `writer_pages` flag is on for; the page itself
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
    if (!(await memberHasWriterPages(service, memberId))) return { error: WRITER_PAGES_NOT_AVAILABLE };
    if (item === "photo" && publishablePhotoUrl((await repos.members.byId(memberId))?.photoUrl) === null) {
      return { error: "There is no photo that can be shown on a public page. A Gravatar picture is never published, because its address carries a code made from your email." };
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
    if (page) revalidatePath(writerPagePath(page.handle));
  }
  return { success: true };
}

// Usage analytics: each action records whether it worked (lib/analytics/server.ts), never which item or level.
export async function setProfileVisibility(...args: Parameters<typeof setProfileVisibilityImpl>): ReturnType<typeof setProfileVisibilityImpl> {
  return withAction("profile_visibility_set", () => setProfileVisibilityImpl(...args));
}
