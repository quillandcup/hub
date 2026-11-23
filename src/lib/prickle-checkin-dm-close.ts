import type { SupabaseClient } from "@supabase/supabase-js";
import { after } from "next/server";
import { createRepos } from "@/lib/data/repos";
import type { CheckinHalfKind } from "@/lib/data/prickle-activity";
import { createSlackClient } from "@/lib/slack-client";
import { getSlackBotToken } from "@/lib/slack-bot-token";
import { isSlackTestMode } from "@/lib/slack";
import { getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";
import { chatSlackWritesEnabled } from "@/modules/chat/slack/post";
import { slackReadCovers } from "@/modules/chat/slack/read";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { checkinAnswered, checkoutAnswered, type CheckinInput } from "@/lib/prickle-checkins";
import { closedDmBlocks } from "@/lib/prickle-checkin-dms";

/**
 * A check-in or check-out answered or skipped in the Hub (the prickle page, Log Progress, the search
 * palette's "mark as done") closes its Slack DM the way a Submit in Slack does: the message collapses to
 * the closed note, and for a member who connected Slack with the direct message scopes it is also
 * marked read as them, so Slack's unread badge goes. Slack's own Submit / Skip already collapse the
 * message, so they don't come here. docs/product/SLACK_BRIDGED_CHAT.md, "Read state shared with Slack".
 *
 * Only a DM sent since the message's timestamp was kept (its log row has one) can be found; older ones
 * are left alone (prickle-checkin-dm-cleanup.ts closed those by reading history). Service role.
 */

/** Slack says the message can no longer be edited or found: nothing is left to collapse, so don't try again. */
const GONE = ["message_not_found", "channel_not_found", "cant_update_message", "is_archived", "edit_window_closed"];
const NOT_ABLE_TO_MARK = ["missing_scope", "not_in_channel", "channel_not_found"];

const errorCode = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;
const isRateLimited = (error: unknown): boolean => (error as { code?: string } | null)?.code === "slack_webapi_rate_limited_error";

/** The halves a saved check-in has answered. */
export function answeredHalves(checkin: CheckinInput): CheckinHalfKind[] {
  return [...(checkinAnswered(checkin) ? (["checkin"] as const) : []), ...(checkoutAnswered(checkin) ? (["checkout"] as const) : [])];
}

/**
 * Collapses the member's DM for each of these halves of `prickleId` and marks it read in Slack. Does
 * nothing outside production or in Slack test mode (the message then went to the dev user), for a DM
 * with no kept timestamp, or for one already collapsed. Never throws: Slack being unavailable must not
 * cost anyone their saved answer, so failures are logged and the DM simply stays as it was.
 */
export async function closeCheckinDms(
  service: SupabaseClient,
  { memberId, prickleId, halves }: { memberId: string; prickleId: string; halves: CheckinHalfKind[] }
): Promise<void> {
  if (halves.length === 0 || !chatSlackWritesEnabled() || isSlackTestMode()) return;
  const repo = createRepos(service).prickleActivity;
  for (const half of halves) {
    try {
      const kind = half === "checkin" ? "prickle_checkin" : "prickle_checkout";
      const dm = await repo.dmMessage(prickleId, memberId, kind);
      if (!dm?.message || dm.closedAt) continue;
      const { channelId, ts } = dm.message;

      const botToken = await getSlackBotToken();
      if (!botToken) continue;
      try {
        await createSlackClient(botToken).chat.update({ channel: channelId, ts, ...closedDmBlocks(half, prickleId) });
      } catch (error) {
        if (!GONE.includes(errorCode(error) ?? "")) {
          console.error("closeCheckinDms: collapsing the DM failed for member %s:", memberId, error);
          continue; // still open: the next answer tries again
        }
      }
      if (!(await repo.markDmClosed(prickleId, memberId, kind))) continue; // another request got there first
      await markRead(service, memberId, channelId, ts);
    } catch (error) {
      console.error("closeCheckinDms failed for member %s:", memberId, error);
    }
  }
}

/** Moves the member's own read marker in the DM up to the closed message, never backward. */
async function markRead(service: SupabaseClient, memberId: string, channelId: string, ts: string): Promise<void> {
  const connection = await getSlackUserToken(service, memberId);
  if (!connection) return;
  const slack = createSlackClient(connection.token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  try {
    const info = await slack.conversations.info({ channel: channelId });
    if (slackReadCovers(info.channel?.last_read, ts)) return;
    await slack.conversations.mark({ channel: channelId, ts });
  } catch (error) {
    if (isDeadTokenError(error)) await service.rpc("slack_connection_revoke", { p_member: memberId });
    // Connected before the direct message scopes were asked for, or not in that conversation in Slack: nothing to do.
    else if (!NOT_ABLE_TO_MARK.includes(errorCode(error) ?? "") && !isRateLimited(error)) {
      console.error("closeCheckinDms: marking the DM read failed for member %s:", memberId, error);
    }
  }
}

/** After the response goes out, closes these halves' DMs. For the Hub's own actions; Slack's handlers collapse the message themselves. */
export function closeCheckinDmsAfterResponse(args: { memberId: string; prickleId: string; halves: CheckinHalfKind[] }): void {
  if (args.halves.length === 0) return;
  after(() => closeCheckinDms(createServiceRoleClient(), args).catch((error) => console.error("closeCheckinDms failed:", error)));
}
