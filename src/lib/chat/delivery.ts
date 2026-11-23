import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import type { ChatTransport, DeliveryResult } from "@/lib/chat/transport";
import { chatTransport } from "@/lib/chat/transports";

/**
 * The outbox (docs/product/SLACK_BRIDGED_CHAT.md, "Hub -> Slack"), the part that is chat's and not a transport's. A message a member wrote
 * in the Hub is stored as 'pending' (chat_post_message); the transport sends it and answers how it went (`SendOutcome`), and core records
 * that on the message: the reference the transport gave it and how it went out, or that it failed (the author then sees "didn't send"
 * with a Retry). A transport never writes delivery status itself. Service role.
 */

/** Sends one stored message through the transport and records the outcome. */
export async function deliverChatMessage(supabase: SupabaseClient, messageId: string, transport: ChatTransport = chatTransport()): Promise<DeliveryResult> {
  const outcome = await transport.send(supabase, messageId);
  if (outcome.status === "skipped") return "skipped";
  const chat = createRepos(supabase as unknown as Db).chat;

  if (outcome.status === "failed") {
    // Best effort: a failure to record the failure must not hide the original reason (the transport has logged it).
    await chat.markFailed(messageId).catch((markError) => console.error("chat_mark_message_failed failed for %s:", messageId, markError));
    return "failed";
  }

  if (outcome.ref) {
    // How it was posted is a nicety (its failure is ignored); recording the reference is what matters.
    const [recorded] = await Promise.allSettled([chat.markSent(messageId, outcome.ref), outcome.via ? chat.setPostedVia(messageId, outcome.via) : Promise.resolve()]);
    if (recorded.status === "rejected") {
      // Delivered but not recorded: leave it pending (not failed) so the transport's own event can still link it.
      console.error("chat_mark_message_sent failed for %s:", messageId, recorded.reason instanceof Error ? recorded.reason.message : recorded.reason);
    }
  }
  return "sent";
}

/** A message is retried only once it is this old, so a retry never races the request that is still sending it. */
const RETRY_AFTER_MS = 2 * 60 * 1000;
/** ...and not once it is this old: a message that stale would arrive out of context. */
const RETRY_UNTIL_MS = 24 * 60 * 60 * 1000;
const RETRY_BATCH = 50;

/**
 * The outbox's retry (nightly chat run): app messages still pending or failed, oldest first so they are delivered in the order they were
 * written. Returns how many were sent.
 */
export async function retryUnsentChatMessages(
  supabase: SupabaseClient,
  transport: ChatTransport = chatTransport()
): Promise<{ sent: number; failed: number; expired: number }> {
  const now = clock.now();

  // A message still pending after the window will never be retried here, and "Sending…" forever
  // is a lie: mark it failed, so its author sees "didn't send" with a Retry button
  // (their call whether a day-old message is still worth sending). Its id is unchanged, so a
  // retry sends the same row; one whose echo did arrive is already 'sent' and not touched.
  const chat = createRepos(supabase as unknown as Db).chat;
  const expired = await chat.expireStalePending(new Date(now - RETRY_UNTIL_MS).toISOString());

  const ids = await chat.unsentMessageIds({
    createdBefore: new Date(now - RETRY_AFTER_MS).toISOString(),
    createdAfter: new Date(now - RETRY_UNTIL_MS).toISOString(),
    limit: RETRY_BATCH,
  });

  let sent = 0;
  let failed = 0;
  for (const id of ids) {
    const result = await deliverChatMessage(supabase, id, transport);
    if (result === "sent") sent++;
    else if (result === "failed") failed++;
  }
  return { sent, failed, expired };
}
