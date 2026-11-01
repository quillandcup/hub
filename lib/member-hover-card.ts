import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { safeUrl } from "@/lib/url";
import { getSlackDmLinksForMembers } from "@/lib/member-slack-links";

/** The most "Ask me about…" topics the hover card lists; the full profile has the rest. */
export const HOVER_CARD_MAX_TOPICS = 3;

/** What the profile-at-a-glance shows about a member: only fields every member can already read. */
export interface MemberHoverCardData {
  id: string;
  name: string;
  photoUrl: string | null;
  /** Month the member first joined, as a date (YYYY-MM-DD), when they have been a paying member. */
  firstJoinedAt: string | null;
  askMeAbout: string[];
  instagramUrl: string | null;
  facebookUrl: string | null;
  twitterUrl: string | null;
  /** Where "Message" goes today (a Slack DM); null when the member has no matched Slack account. */
  messageUrl: string | null;
}

/**
 * One member's hover card, read under the caller's RLS from member_directory and their "Ask me
 * about…" topics. The Slack link is resolved server-side (lib/member-slack-links.ts), so no email
 * or alias reaches the browser. Null when the member isn't visible to the caller.
 */
export async function loadMemberHoverCard(supabase: SupabaseClient, memberId: string): Promise<MemberHoverCardData | null> {
  const [m, topics, slackLinks] = await Promise.all([
    createRepos(supabase).directory.byId(memberId),
    createRepos(supabase).memberProfile.askMeAbout(memberId),
    getSlackDmLinksForMembers([memberId]),
  ]);
  if (!m) return null;
  return {
    id: m.id,
    name: m.display_name || m.name,
    photoUrl: safeUrl(m.photo_url),
    firstJoinedAt: m.first_joined_at ?? null,
    askMeAbout: topics.slice(0, HOVER_CARD_MAX_TOPICS),
    instagramUrl: safeUrl(m.instagram_url),
    facebookUrl: safeUrl(m.facebook_url),
    twitterUrl: safeUrl(m.twitter_url),
    messageUrl: slackLinks.get(memberId) ?? null,
  };
}
