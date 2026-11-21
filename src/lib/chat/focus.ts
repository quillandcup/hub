import type { Repos } from "@/lib/data/repos";

/**
 * A `?m=<message id>` link: the message's permalink, in a form the server can read, so it survives sign-in (a `#m-` fragment never
 * reaches the server) and works from anywhere the link is pasted. The message has to be in this conversation and readable by the
 * viewer (row-level security); a reply also names the thread it is in, which the page opens, since replies are not in the conversation's
 * list. Null for a message that isn't there (the link is then just the conversation). Run as the viewer.
 */
export async function resolveFocus(
  repos: Pick<Repos, "chat">,
  channelId: string,
  messageId: string,
): Promise<{ id: string; threadRootId: string | null } | null> {
  const [row, target] = await Promise.all([
    repos.chat.messageById(channelId, messageId).catch(() => null),
    repos.chat.slackTarget(messageId).catch(() => null),
  ]);
  return row ? { id: messageId, threadRootId: target?.threadRootId ?? null } : null;
}

/** The permalink of a message: the conversation with `?m=` asking for it (the thread and the scrolling follow from the server). */
export const messagePermalink = (channelId: string, messageId: string) => `/chat/${channelId}?m=${messageId}`;
