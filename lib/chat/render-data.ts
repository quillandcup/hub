import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { loadChatChannels } from "@/lib/chat/load";

/**
 * The member's conversations for rendering a chat page: the layout and the page both need them, and on a
 * full load (first visit, refresh) they share this one read instead of making two. Memoized for one
 * render only. Not for server actions, which read the list around a write and want it current.
 * Kept out of `lib/chat/load.ts`, which a client component imports.
 */
export const loadChatChannelsForRender = cache(async (memberId: string, isSudo: boolean) =>
  loadChatChannels(await createClient(), memberId, isSudo)
);
