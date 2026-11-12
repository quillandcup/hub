import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import { normalizeLinkForMatch } from "@/lib/chat/unfurl-dedupe";
import { safeLinkUrl } from "@/lib/chat/unfurls";

/**
 * The author of a message written in the Hub removed Slack's link preview INSIDE SLACK ("remove preview"): hide the Hub's own preview of
 * that link too, by the same mark the X in the Hub writes (`chat_hidden_unfurls`, key `url:<address>`; docs/SLACK_BRIDGED_CHAT.md, "Link
 * previews for messages written in the Hub"). The reverse direction is lib/chat/slack-unfurl-removal.ts.
 *
 * A message written in the Hub shows two cards for a link (Slack's attachment and the Hub's own); the Hub shows only its own. Slack
 * dropping its attachment therefore changes nothing on screen unless we act on it. The signal is Slack sending the message again with an
 * attachment fewer: so the comparison needs the attachments we held BEFORE the new payload overwrites them, and it is done at ingestion in
 * TypeScript, not in the Bronze -> Silver SQL (the projection only sees the newest payload; the mark is Local data that reprocessing keeps).
 *
 * ONE function serves every path that writes Bronze messages (the Events webhook, the Slack imports and the chat's gap-fill): the nightly
 * import is the pull-based twin of the webhook ("nothing through webhooks alone"). Call it before the write.
 *
 * What counts as a removal, deliberately narrow:
 * - the message was written in the Hub (origin app, live), so a message written in Slack is never touched: its card IS Slack's attachment;
 * - the text is unchanged: an edit re-unfurls and the Hub already forgets previews of links an edit took out (lib/chat/link-previews.ts);
 * - an attachment that was stored is gone (none of its addresses is on a remaining attachment), and the Hub has a preview for that address.
 *   The first arrival of an unfurl (nothing stored yet) is not a removal;
 * - a link Slack never unfurled gives no signal, so removing nothing in Slack hides nothing in the Hub (documented limit).
 * The Hub's own X echoes back as the same event: its mark is already there and the write is once per card, so it is a no-op.
 *
 * Slack lets only the poster remove a preview, and the Hub-origin check above establishes the message; the mark is written with the service
 * role (row-level security lets only the author write it) and is the author's removal. Never throws: ingestion must not fail for this.
 */

export interface IncomingSlackMessage {
  channel_id: string;
  message_ts: string;
  raw_payload: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The normalized addresses one legacy attachment is about (its original, source or title address). */
function addressesOf(attachment: unknown): Set<string> {
  const out = new Set<string>();
  if (!isRecord(attachment)) return out;
  for (const l of [attachment.original_url, attachment.from_url, attachment.title_link]) {
    const n = normalizeLinkForMatch(typeof l === "string" ? l : null);
    if (n) out.add(n);
  }
  return out;
}

/**
 * The addresses of the attachments that `previous` had and `next` no longer has, when nothing else about the message changed (same text).
 * Empty when the text differs (an edit), when there was nothing before, or when nothing went. Pure.
 */
export function removedAttachmentAddresses(previous: Record<string, unknown>, next: Record<string, unknown>): Set<string> {
  const gone = new Set<string>();
  const before = Array.isArray(previous.attachments) ? previous.attachments : [];
  if (before.length === 0) return gone;
  if ((previous.text ?? "") !== (next.text ?? "")) return gone;
  const remaining = new Set<string>();
  for (const a of Array.isArray(next.attachments) ? next.attachments : []) for (const n of addressesOf(a)) remaining.add(n);
  for (const a of before) {
    const own = addressesOf(a);
    if (own.size === 0 || [...own].some((n) => remaining.has(n))) continue;
    for (const n of own) gone.add(n);
  }
  return gone;
}

/** Returns how many Hub previews were hidden. */
export async function hideHubPreviewsRemovedInSlack(supabase: SupabaseClient, incoming: IncomingSlackMessage[]): Promise<number> {
  try {
    // Only a payload that is a message object can be compared; the last one wins when a batch repeats a message.
    const latest = new Map<string, IncomingSlackMessage & { raw_payload: Record<string, unknown> }>();
    for (const m of incoming) if (isRecord(m.raw_payload) && m.message_ts && m.channel_id) latest.set(`${m.channel_id}|${m.message_ts}`, { ...m, raw_payload: m.raw_payload });
    if (latest.size === 0) return 0;

    const repos = createRepos(supabase as unknown as Db);
    // 1. Which of them were written in the Hub: one chunked lookup for the whole batch.
    const hub = (await repos.chat.appMessagesBySlackTs([...latest.values()].map((m) => m.message_ts))).filter((t) => t.slackChannelId && t.slackTs && latest.has(`${t.slackChannelId}|${t.slackTs}`));
    if (hub.length === 0) return 0;

    // 2. What we held before, per channel (in parallel), and the Hub's own previews of those messages.
    const byChannel = new Map<string, string[]>();
    for (const t of hub) byChannel.set(t.slackChannelId!, [...(byChannel.get(t.slackChannelId!) ?? []), t.slackTs!]);
    const [stored, previews] = await Promise.all([
      Promise.all([...byChannel].map(async ([channel, ts]) => [channel, await repos.slackMessages.rawPayloads(channel, ts)] as const)),
      repos.chatLinkPreviews.forMessages(hub.map((t) => t.id)),
    ]);
    const previousOf = new Map(stored.map(([channel, payloads]) => [channel, payloads]));

    // 3. Compare and collect the marks.
    const marks: { messageId: string; key: string }[] = [];
    for (const t of hub) {
      const previous = previousOf.get(t.slackChannelId!)?.get(t.slackTs!);
      const now = latest.get(`${t.slackChannelId}|${t.slackTs}`);
      if (!previous || !now) continue;
      const gone = removedAttachmentAddresses(previous, now.raw_payload);
      if (gone.size === 0) continue;
      for (const p of previews.get(t.id) ?? []) {
        const matches = [p.url, p.finalUrl].some((a) => {
          const n = normalizeLinkForMatch(a);
          return n !== null && gone.has(n);
        });
        const written = safeLinkUrl(p.url);
        // The key is the address as written in the message: what the X in the Hub stores (lib/chat/link-preview-cards.ts).
        if (matches && written) marks.push({ messageId: t.id, key: `url:${written}` });
      }
    }
    // 4. Once per card (the write is idempotent), as the author's removal: service role, after the origin check above.
    await Promise.all(marks.map((m) => repos.chatLinkPreviews.hide(m.messageId, m.key)));
    if (marks.length > 0) console.log("[chat] hid %d Hub link preview(s) the author removed in Slack", marks.length);
    return marks.length;
  } catch (error) {
    console.error("[chat] checking for previews removed in Slack failed:", error instanceof Error ? error.message : "unknown error");
    return 0;
  }
}
