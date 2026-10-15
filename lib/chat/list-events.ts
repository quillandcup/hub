import type { ChatMessageView } from "@/lib/chat/load";
import type { ChatTextContext } from "@/components/chat/ChatText";

/**
 * How the parts of an open conversation talk to each other in the browser, so a change shows up
 * without re-rendering the whole page and layout (which took several seconds). Client-side only:
 * nothing here is stored.
 *
 * - **List events**, sent to the conversation's message list (`MessageList`) and to an open
 *   thread's (`ThreadList`): the composer shows a message the member just sent before the server has
 *   finished with it, and `ChatLive` hands over the messages it fetched (one small server action
 *   instead of a page refresh).
 * - **Poke**: "something changed here, bring it up to date" (the composer after a send, a reaction
 *   after a toggle). The conversation's `ChatLive` answers with that same small fetch; if nothing
 *   is listening (a page with no live conversation), the caller falls back to a page refresh.
 */

/** A message that hasn't been saved yet has this id until the action returns the real one. */
export const PENDING_ID_PREFIX = "pending-";
export const isPendingId = (id: string) => id.startsWith(PENDING_ID_PREFIX);

export type ListEvent =
  /** Show a message the member just sent (a reply when `threadRootId` is set, else in the conversation). */
  | { kind: "add"; channelId: string; threadRootId?: string; view: ChatMessageView }
  /** The action returned: swap the placeholder for the saved message (same text, its real id). */
  | { kind: "swap"; channelId: string; threadRootId?: string; tempId: string; view: ChatMessageView }
  /** The send failed: take the placeholder away. */
  | { kind: "drop"; channelId: string; threadRootId?: string; tempId: string }
  /** The newest messages as the server has them now (newer data wins, by id). */
  | { kind: "merge"; channelId: string; views: ChatMessageView[]; ctx: ChatTextContext }
  /** An open thread as the server has it now: the root first, then its replies (newer data wins, by id). */
  | { kind: "merge-thread"; channelId: string; threadRootId: string; views: ChatMessageView[]; ctx: ChatTextContext };

type Listener = (event: ListEvent) => void;
const listeners = new Set<Listener>();

export function subscribeListEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitListEvent(event: ListEvent): void {
  for (const listener of [...listeners]) listener(event);
}

const pokeHandlers = new Map<string, Set<() => void>>();

/** A live conversation answers pokes for its channel until it unmounts. */
export function onPoke(channelId: string, handler: () => void): () => void {
  const set = pokeHandlers.get(channelId) ?? new Set();
  set.add(handler);
  pokeHandlers.set(channelId, set);
  return () => {
    set.delete(handler);
    if (set.size === 0) pokeHandlers.delete(channelId);
  };
}

/** Ask the open conversation to bring itself up to date. False when none is open (refresh the page instead). */
export function pokeChat(channelId: string): boolean {
  const set = pokeHandlers.get(channelId);
  if (!set || set.size === 0) return false;
  for (const handler of [...set]) handler();
  return true;
}

/** The message as the conversation shows it while it is still being saved or sent. */
export function optimisticView(opts: {
  id: string;
  body: string;
  viewer: { memberId: string; name: string; photoUrl: string | null };
  createdAt?: string;
}): ChatMessageView {
  return {
    id: opts.id,
    authorMemberId: opts.viewer.memberId,
    authorName: opts.viewer.name,
    authorPhotoUrl: opts.viewer.photoUrl,
    replyAuthors: [],
    createdAt: opts.createdAt ?? new Date().toISOString(),
    editedAt: null,
    body: opts.body,
    contentState: "ok",
    hasFiles: false,
    replyCount: 0,
    lastReplyAt: null,
    reactions: [],
    syncStatus: "pending",
    mine: true,
  };
}
