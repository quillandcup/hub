import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { setChatPreviewsInSlack } from "@/lib/chat/slack-edit";
import { normalizeLinkForMatch } from "@/lib/chat/unfurl-dedupe";
import { isBlocked, type PreviewBlock } from "@/lib/chat/link-preview-blocks";
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
 * `chat.update` insists on text or blocks, so the message's current text and blocks go back as Slack holds them (Bronze `raw_payload`);
 * if Bronze has no such message, or no content in it, nothing is sent and the reason is alerted (`no_slack_copy`, `no_slack_content`).
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

/**
 * Like `splitAttachments`, but the ones to remove are Slack's previews of an address the author blocked (any of its `original_url`, `from_url`
 * or `title_link` is covered by one of the rules; lib/chat/link-preview-blocks.ts). Pure.
 */
export function splitBlockedAttachments(attachments: unknown, blocks: readonly PreviewBlock[]): { removed: number; keep: Record<string, unknown>[] } {
  const keep: Record<string, unknown>[] = [];
  let removed = 0;
  for (const a of Array.isArray(attachments) ? attachments : []) {
    if (!isRecord(a)) continue;
    if ([a.original_url, a.from_url, a.title_link].some((l) => typeof l === "string" && isBlocked(l, blocks))) removed++;
    else keep.push(forSlack(a));
  }
  return { removed, keep };
}

/**
 * Best effort: a message written in the Hub whose author blocked a link in it, when Slack's unfurl of that message arrives (the webhook, the
 * import and the gap-fill all call this through `hideHubPreviewsRemovedInSlack`; an edit that adds a link is the same arrival, since Slack
 * unfurls again after `chat.update`). Slack unfurls a message as a whole, so with one blocked link and another link there is a card for the
 * blocked one: the Hub never shows it (`withLinkPreviews`), and this takes it off the Slack copy too, as removing a preview does. Works from the
 * payload that just arrived, not from the projection (which may lag it). Never throws and a failure (alerted like a removal's) changes nothing
 * on the Hub; once the card is gone Slack's next payload has nothing to match, so it does not repeat. Returns how many messages were updated.
 */
export async function removeBlockedSlackUnfurls(supabase: SupabaseClient, incoming: { channel_id: string; message_ts: string; raw_payload: unknown }[]): Promise<number> {
  try {
    if (!chatSlackWritesEnabled()) return 0;
    const withCards = new Map<string, { channel_id: string; message_ts: string; payload: Record<string, unknown> }>();
    for (const m of incoming) {
      if (isRecord(m.raw_payload) && Array.isArray(m.raw_payload.attachments) && m.raw_payload.attachments.length > 0 && m.channel_id && m.message_ts) {
        withCards.set(`${m.channel_id}|${m.message_ts}`, { channel_id: m.channel_id, message_ts: m.message_ts, payload: m.raw_payload });
      }
    }
    if (withCards.size === 0) return 0;
    const repos = createRepos(supabase as unknown as Db);
    const hub = (await repos.chat.appMessagesBySlackTs([...withCards.values()].map((m) => m.message_ts))).filter(
      (t) => t.slackChannelId && t.slackTs && t.authorMemberId && withCards.has(`${t.slackChannelId}|${t.slackTs}`)
    );
    if (hub.length === 0) return 0;
    const blocksOf = await repos.chatLinkPreviews.blocksOfMembers(hub.map((t) => t.authorMemberId as string));
    let updated = 0;
    for (const t of hub) {
      const blocks = blocksOf.get(t.authorMemberId as string);
      const arrived = withCards.get(`${t.slackChannelId}|${t.slackTs}`);
      if (!blocks || !arrived) continue;
      const { removed, keep } = splitBlockedAttachments(arrived.payload.attachments, blocks);
      if (removed === 0) continue;
      const text = typeof arrived.payload.text === "string" && arrived.payload.text !== "" ? arrived.payload.text : undefined;
      const slackBlocks = Array.isArray(arrived.payload.blocks) && arrived.payload.blocks.length > 0 ? arrived.payload.blocks : undefined;
      if (text === undefined && !slackBlocks) {
        await fail(repos, t.id, "no_slack_content");
        continue;
      }
      const row = await repos.chat.outboxMessage(t.id);
      const files = parseChatFiles(row?.files).map((f) => f.id);
      const result = await setChatPreviewsInSlack(supabase, { messageId: t.id, memberId: t.authorMemberId as string, content: { text, blocks: slackBlocks }, attachments: keep, keepFileIds: files });
      if (result.ok) {
        updated++;
        continue;
      }
      console.error("[chat] taking a blocked preview off the Slack copy of %s failed: %s", t.id, result.code ?? "unknown");
      if (result.code !== "not_allowed" && result.code !== "token_dead") {
        const reason = /^[a-z_]{1,40}$/.test(result.code ?? "") ? result.code! : "other";
        await sendOperationsAlert(repos, { type: "slack_unfurl_removal_failed", reason }).catch(() => {});
      }
    }
    return updated;
  } catch (error) {
    console.error("[chat] taking blocked previews off the Slack copies failed:", error instanceof Error ? error.message : "unknown error");
    return 0;
  }
}

/** Logs and alerts a failure of ours (a reason in lower-case words, never an address) and answers `failed`. */
async function fail(repos: ReturnType<typeof createRepos>, messageId: string, reason: string): Promise<"failed"> {
  console.error("[chat] taking a preview off the Slack copy of %s failed: %s", messageId, reason);
  await sendOperationsAlert(repos, { type: "slack_unfurl_removal_failed", reason }).catch(() => {});
  return "failed";
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
    // chat.update needs the message's text or blocks; they go back as Slack holds them, from Bronze (service role: the caller was checked
    // as the author above). Hub's own body is not used: it is not Slack's escaped form.
    const payload = row.slackChannelId ? await repos.slackMessages.rawPayload(row.slackChannelId, row.slackTs) : null;
    const text = typeof payload?.text === "string" && payload.text !== "" ? payload.text : undefined;
    const blocks = Array.isArray(payload?.blocks) && payload.blocks.length > 0 ? payload.blocks : undefined;
    if (!payload || (text === undefined && !blocks)) return await fail(repos, opts.messageId, payload ? "no_slack_content" : "no_slack_copy");
    const files = parseChatFiles(row.files).map((f) => f.id);
    const result = await setChatPreviewsInSlack(supabase, { messageId: opts.messageId, memberId: opts.memberId, content: { text, blocks }, attachments: keep, keepFileIds: files });
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
