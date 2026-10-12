import type { ChatMessageView } from "@/lib/chat/load";

/**
 * A message the member just sent, shown in the conversation before the server has finished with it.
 * Sending takes a second or two (the action) and the page's own refresh a few more, so the composer
 * announces the message here and the conversation's list adds it at once; the real row replaces it
 * when the action returns, and the page refresh that follows overwrites that copy by id. Client-side
 * only: nothing here is stored.
 */

/** A message that hasn't been saved yet has this id until the action returns the real one. */
export const PENDING_ID_PREFIX = "pending-";
export const isPendingId = (id: string) => id.startsWith(PENDING_ID_PREFIX);

export type OptimisticEvent =
  /** Show a message the member just sent. */
  | { kind: "add"; channelId: string; view: ChatMessageView }
  /** The action returned: swap the placeholder for the saved message (same text, its real id). */
  | { kind: "swap"; channelId: string; tempId: string; view: ChatMessageView }
  /** The send failed: take the placeholder away. */
  | { kind: "drop"; channelId: string; tempId: string };

type Listener = (event: OptimisticEvent) => void;
const listeners = new Set<Listener>();

export function subscribeOptimistic(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitOptimistic(event: OptimisticEvent): void {
  for (const listener of [...listeners]) listener(event);
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
