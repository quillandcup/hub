/**
 * A change to a draft, told to the chat sidebar's Drafts list in the browser so it follows the box
 * as the member types (the layout that loaded the list doesn't re-run on client navigation).
 * Client-side only: nothing here is stored. `body` is Slack markup; blank text and no files means
 * the draft is gone.
 */
export interface DraftChange {
  channelId: string;
  threadRootId: string | null;
  body: string;
  fileCount: number;
}

const EVENT = "chat:draft";

export function emitDraftChange(change: DraftChange): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<DraftChange>(EVENT, { detail: change }));
}

export function subscribeDraftChanges(listener: (change: DraftChange) => void): () => void {
  const handler = (e: Event) => listener((e as CustomEvent<DraftChange>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
