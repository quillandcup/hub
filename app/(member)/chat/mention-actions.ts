"use server";

import { postingCaller } from "@/lib/chat/caller";
import { createRepos } from "@/lib/data/repos";
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
 * Who or what the member can mention while writing in a conversation: `@` suggests people (the ones in it
 * first; anyone active with a Slack account to mention), `#` the channels they can see. Same gate as posting. Names only, from
 * what the member can already read.
 */
export async function suggestMentions(channelId: string, trigger: "@" | "#", query: string): Promise<MentionSuggestion[]> {
  const text = query.trim().toLowerCase().slice(0, 40);
  if (!isId(channelId, "chn") || (trigger !== "@" && trigger !== "#")) return [];
  const caller = await postingCaller();
  if (!caller) return [];
  const supabase = await createClient();
  const channel = await loadChannelForMember(createRepos(supabase), channelId, caller.identity.memberId, caller.identity.isSudo);
  if (!channel) return [];

  if (trigger === "#") {
    const channels = await loadChatChannels(createRepos(supabase), caller.identity.memberId, caller.identity.isSudo);
    return channels
      .filter((c) => c.kind === "channel" && !c.archived && c.slackChannelId && c.label.slice(1).toLowerCase().includes(text))
      .map((c) => ({ label: c.label, token: `<#${c.slackChannelId}>`, photoUrl: null }))
      .sort((a, b) => rank(a.label, text) - rank(b.label, text) || a.label.localeCompare(b.label))
      .slice(0, MAX_SUGGESTIONS);
  }

  const service = createServiceRoleClient();
  const inConversation = await loadChannelMembers(createRepos(supabase), channelId);
  const here = new Set(inConversation.map((p) => p.memberId));
  const found = new Map<string, { memberId: string; name: string; photoUrl: string | null }>(
    inConversation.filter((p) => p.name.toLowerCase().includes(text)).map((p) => [p.memberId, p])
  );

  // Anyone can be mentioned, not just the people already in this conversation (Slack lets you): what is typed
  // searches the whole directory, and the people here come first. A bare `@` offers just the people here.
  if (text.length > 0) {
    const matches = (await createRepos(service).directory.matching(text, 40)).filter((m) => !found.has(m.id));
    const active = new Set((await createRepos(service).members.byIds(matches.map((m) => m.id))).filter((m) => m.status === "active").map((m) => m.id));
    for (const m of matches) {
      if (active.has(m.id)) found.set(m.id, { memberId: m.id, name: m.display_name || m.name, photoUrl: m.photo_url ?? null });
    }
  }

  const people = [...found.values()]
    .filter((p) => p.memberId !== caller.identity.memberId)
    .map((p) => ({ ...p, label: `@${p.name}` }))
    .sort((a, b) => Number(here.has(b.memberId)) - Number(here.has(a.memberId)) || rank(a.label, text) - rank(b.label, text) || a.name.localeCompare(b.name))
    .slice(0, MAX_SUGGESTIONS * 4);
  if (people.length === 0) return [];
  // Only people the Hub can name to Slack: no Slack account, nothing to mention.
  const slackIds = await slackUserIdsFor(createRepos(service), people.map((p) => p.memberId));
  return people
    .filter((p) => slackIds.has(p.memberId))
    .slice(0, MAX_SUGGESTIONS)
    .map((p) => ({ label: p.label, token: `<@${slackIds.get(p.memberId)}>`, photoUrl: p.photoUrl }));
}
