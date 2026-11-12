import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { setChatPreviewsInSlack } from "@/lib/chat/slack-edit";
import { normalizeLinkForMatch } from "@/lib/chat/unfurl-dedupe";
import { parseChatFiles } from "@/lib/chat/files";
import { sendOperationsAlert } from "@/lib/operations-alerts";

/**
 * The author removed a link preview from a message written in the Hub: take Slack's own preview of that link off the Slack copy too
 * (docs/SLACK_BRIDGED_CHAT.md, "Link previews for messages written in the Hub"). Best effort and after the Hub's own mark is written,
 * so a failure never undoes the removal; it only means Slack readers may still see the card.
 *
 * Slack's way is `chat.update` with the message's remaining legacy attachments (an empty list removes them all); there is no call that
 * removes one preview (`chat.unfurl` only adds or replaces them). Slack's unfurl of a pasted link is one of the message's attachments,
 * matched to the removed card by its address (`original_url`, `from_url` or `title_link`, normalized like the Hub's own de-duplication).
 * The others are sent back so a message with several previews loses only the one removed; they go back with the documented fields only.
 *
 * Messages written in Slack are never touched: Slack lets the author remove those there. Logs reasons, never an address.
 */

export type SlackUnfurlRemoval = "updated" | "not_needed" | "failed";

/** The legacy attachment fields Slack documents, so only these go back (Slack's own bookkeeping, such as `id` and image sizes, does not). */
const KEPT_FIELDS = [
  "fallback", "color", "pretext", "author_name", "author_link", "author_icon", "title", "title_link", "text", "fields", "image_url", "thumb_url",
  "footer", "footer_icon", "ts", "service_name", "service_icon", "from_url", "original_url",
] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function forSlack(attachment: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(KEPT_FIELDS.flatMap((k) => (attachment[k] === undefined || attachment[k] === null ? [] : [[k, attachment[k]]])));
}

/**
 * Splits a message's stored attachments into the ones that are Slack's preview of an address in `addresses` (to remove, counted) and the
 * rest (to keep, in the shape Slack takes back). Pure.
 */
export function splitAttachments(attachments: unknown, addresses: Set<string>): { removed: number; keep: Record<string, unknown>[] } {
  const keep: Record<string, unknown>[] = [];
  let removed = 0;
  for (const a of Array.isArray(attachments) ? attachments : []) {
    if (!isRecord(a)) continue;
    const links = [a.original_url, a.from_url, a.title_link].map((l) => normalizeLinkForMatch(typeof l === "string" ? l : null));
    if (links.some((l) => l !== null && addresses.has(l))) removed++;
    else keep.push(forSlack(a));
  }
  return { removed, keep };
}

export async function removeSlackUnfurl(supabase: SupabaseClient, opts: { messageId: string; memberId: string; key: string }): Promise<SlackUnfurlRemoval> {
  try {
    // A card with no address (`idx:`) is an app's, which a message written in the Hub does not have; nothing to match in Slack.
    if (!opts.key.startsWith("url:") || !chatSlackWritesEnabled()) return "not_needed";
    const repos = createRepos(supabase as unknown as Db);
    const row = await repos.chat.outboxMessage(opts.messageId);
    if (!row || row.deletedAt || row.origin !== "app" || row.authorMemberId !== opts.memberId || !row.slackTs) return "not_needed";
    const context = await repos.chat.unfurlContext(opts.messageId);
    if (!Array.isArray(context?.attachments) || context.attachments.length === 0) return "not_needed";

    // The address as written, and where the Hub's own preview of it ended up (Slack may report either).
    const first = normalizeLinkForMatch(opts.key.slice("url:".length));
    const addresses = new Set<string>();
    if (first) addresses.add(first);
    for (const p of (await repos.chatLinkPreviews.forMessages([opts.messageId])).get(opts.messageId) ?? []) {
      if (normalizeLinkForMatch(p.url) !== first) continue;
      const final = normalizeLinkForMatch(p.finalUrl);
      if (final) addresses.add(final);
    }

    const { removed, keep } = splitAttachments(context.attachments, addresses);
    if (removed === 0) return "not_needed";
    const files = parseChatFiles(row.files).map((f) => f.id);
    const result = await setChatPreviewsInSlack(supabase, { messageId: opts.messageId, memberId: opts.memberId, attachments: keep, keepFileIds: files });
    if (result.ok) return "updated";

    console.error("[chat] taking a preview off the Slack copy of %s failed: %s", opts.messageId, result.code ?? "unknown");
    // A member who has not connected Slack, or whose connection died, is theirs to fix and is not a fault of ours; the rest is.
    if (result.code !== "not_allowed" && result.code !== "token_dead") {
      const reason = /^[a-z_]{1,40}$/.test(result.code ?? "") ? result.code! : "other";
      await sendOperationsAlert(repos, { type: "slack_unfurl_removal_failed", reason }).catch(() => {});
    }
    return "failed";
  } catch (error) {
    console.error("[chat] taking a preview off the Slack copy of %s failed:", opts.messageId, error instanceof Error ? error.message : "unknown error");
    return "failed";
  }
}
