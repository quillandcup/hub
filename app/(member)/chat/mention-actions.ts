"use server";

import { postingCaller } from "@/lib/chat/caller";
import { isId } from "@/lib/ids";
import { loadChannelForMember, loadChannelMembers, loadChatChannels } from "@/lib/chat/load";
import { slackUserIdsFor } from "@/lib/chat/slack-membership";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

export interface MentionSuggestion {
  /** "@Ania Ray" or "#general": what the box shows and the text the member can keep typing. */
  label: string;
  /** What Slack gets: `<@U…>` or `<#C…>`. */
  token: string;
  photoUrl: string | null;
}

const MAX_SUGGESTIONS = 6;

/** Names that start with what was typed come first, then ones with it inside a word. */
const rank = (label: string, query: string): number => {
  const name = label.slice(1).toLowerCase();
  if (name.startsWith(query)) return 0;
  return name.split(/[\s_-]+/).some((w) => w.startsWith(query)) ? 1 : 2;
};

/**
 * Who or what the member can mention while writing in a conversation: `@` suggests the people in it (who
 * have a Slack account to mention), `#` the channels they can see. Same gate as posting. Names only, from
 * what the member can already read.
 */
export async function suggestMentions(channelId: string, trigger: "@" | "#", query: string): Promise<MentionSuggestion[]> {
  const text = query.trim().toLowerCase().slice(0, 40);
  if (!isId(channelId, "chn") || (trigger !== "@" && trigger !== "#")) return [];
  const caller = await postingCaller();
  if (!caller) return [];
  const supabase = await createClient();
  const channel = await loadChannelForMember(supabase, channelId, caller.identity.memberId, caller.identity.isSudo);
  if (!channel) return [];

  if (trigger === "#") {
    const channels = await loadChatChannels(supabase, caller.identity.memberId, caller.identity.isSudo);
    return channels
      .filter((c) => c.kind === "channel" && !c.archived && c.slackChannelId && c.label.slice(1).toLowerCase().includes(text))
      .map((c) => ({ label: c.label, token: `<#${c.slackChannelId}>`, photoUrl: null }))
      .sort((a, b) => rank(a.label, text) - rank(b.label, text) || a.label.localeCompare(b.label))
      .slice(0, MAX_SUGGESTIONS);
  }

  const people = (await loadChannelMembers(supabase, channelId))
    .filter((p) => p.memberId !== caller.identity.memberId && p.name.toLowerCase().includes(text))
    .map((p) => ({ ...p, label: `@${p.name}` }))
    .sort((a, b) => rank(a.label, text) - rank(b.label, text) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS * 3);
  if (people.length === 0) return [];
  // Only people the Hub can name to Slack: no Slack account, nothing to mention.
  const slackIds = await slackUserIdsFor(createServiceRoleClient(), people.map((p) => p.memberId));
  return people
    .filter((p) => slackIds.has(p.memberId))
    .slice(0, MAX_SUGGESTIONS)
    .map((p) => ({ label: p.label, token: `<@${slackIds.get(p.memberId)}>`, photoUrl: p.photoUrl }));
}
