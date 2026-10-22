"use server";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { loadMemberHoverCard, type MemberHoverCardData } from "@/lib/member-hover-card";

/** The profile-at-a-glance behind a member's name (components/member/MemberHoverCard.tsx). */
export async function getMemberHoverCard(memberId: string): Promise<{ card: MemberHoverCardData } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "Sign in to see profiles." };
  if (typeof memberId !== "string" || !memberId) return { error: "Couldn't load this profile." };

  try {
    const card = await loadMemberHoverCard(await createClient(), memberId);
    return card ? { card } : { error: "This member isn't available." };
  } catch (err) {
    console.error("Error loading member hover card:", err);
    return { error: "Couldn't load this profile." };
  }
}
