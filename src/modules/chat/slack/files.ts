import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import type { Db } from "@/lib/data/db";
import type { ChatFile } from "@/lib/chat/files";
import { keepCopies } from "@/modules/chat/slack/upload";

/**
 * Files added to a message that is already in Slack, bytes in hand: the permanent copies are kept under the Slack file ids. Looks up
 * where the message lives in Slack itself, so core passes a message id and no Slack channel or ts. A message that never reached Slack
 * has nothing to keep.
 */
export async function keepSlackFileCopies(
  db: SupabaseClient,
  opts: { messageId: string; sent: unknown[]; staged: unknown[]; bytes: Map<string, Buffer> }
): Promise<void> {
  const target = await createRepos(db as unknown as Db).chat.slackTarget(opts.messageId).catch(() => null);
  if (!target?.slackChannelId || !target.slackTs) return;
  await keepCopies(db, opts.sent as ChatFile[], opts.staged as ChatFile[], opts.bytes, target.slackChannelId, target.slackTs);
}
