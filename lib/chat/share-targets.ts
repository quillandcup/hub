import { loadChatChannels, type ChatLoadRepos } from "@/lib/chat/load";

export interface ShareTarget {
  id: string;
  label: string;
}

/**
 * The conversations a member can share a lesson video into: the Slack-bridged channels they have joined and that are
 * still open. Direct messages and group messages are left out for now (docs/TODO.md, "Chat: Watch Videos In The
 * Conversation"). Run with the member's own client, so only conversations they can see are listed.
 */
export async function shareTargets(repos: ChatLoadRepos, memberId: string): Promise<ShareTarget[]> {
  const channels = await loadChatChannels(repos, memberId, false);
  return channels
    .filter((c) => c.kind === "channel" && c.joined && !c.archived && c.slackChannelId !== null)
    .map((c) => ({ id: c.id, label: c.label }));
}
