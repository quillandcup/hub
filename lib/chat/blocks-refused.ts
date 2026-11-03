import * as Sentry from "@sentry/nextjs";
import { sendOperationsAlert } from "@/lib/operations-alerts";
import type { Repos } from "@/lib/data/repos";

/**
 * Slack refused the rich-text blocks of a message (`invalid_blocks`) and the message was sent as plain text instead
 * (lib/chat/slack-post.ts, slack-edit.ts, slack-upload.ts). The member got their message without its list or underline,
 * and the cause is our conversion, not anything they did, so this tells us: a Sentry event with the message id and Slack's
 * error, and an alert in the staff channel (without the id, which is a Hub id; rate limited like the others). Never throws
 * into the send path.
 */
export async function reportRefusedBlocks(repos: Pick<Repos, "rateLimit">, where: "post" | "edit" | "upload", messageId: string, error: unknown): Promise<void> {
  try {
    Sentry.captureException(error, { tags: { chat_blocks_refused: where }, extra: { messageId } });
    await sendOperationsAlert(repos, { type: "slack_blocks_refused", where });
  } catch (reportError) {
    console.error("reportRefusedBlocks failed:", reportError);
  }
}
