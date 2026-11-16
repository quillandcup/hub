import { createRepos } from "@/lib/data/repos";
import type { PreviewBlock } from "@/lib/chat/link-preview-blocks";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * The blocked previews of the authors of the messages being drawn (docs/SLACK_BRIDGED_CHAT.md, "Link previews"). A viewer cannot read another member's
 * rules (owner-only policy), so the server reads them with the service role, once for all the distinct authors of the page, and only uses them to leave a
 * card out: they are never sent to a browser. A failed read only means the cards show as they did before, so it never fails a page.
 */
export async function loadAuthorBlocks(memberIds: string[]): Promise<Map<string, PreviewBlock[]>> {
  if (memberIds.length === 0) return new Map();
  try {
    return await createRepos(createServiceRoleClient()).chatLinkPreviews.blocksOfMembers(memberIds);
  } catch (error) {
    console.error("[chat] reading the blocked previews of authors failed:", error instanceof Error ? error.message : "unknown error");
    return new Map();
  }
}
