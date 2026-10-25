import { revalidateTag } from "next/cache";
import { CHAT_LOOKUPS_TAG } from "@/lib/chat/lookup-cache";

/** Drop the cached Slack names, photos, channel names and custom emoji after their source tables were written. */
export function invalidateChatLookups(): void {
  try {
    revalidateTag(CHAT_LOOKUPS_TAG, { expire: 0 });
  } catch (error) {
    // Outside a Next request there is nothing cached to drop; the TTL covers the rest.
    console.warn("[chat] could not invalidate lookup cache", error);
  }
}
