import { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepos } from "@/lib/data/repos";
import { chatSlackWritesEnabled } from "@/lib/chat/slack-post";
import { getSlackConnectionStatus, getSlackUserToken, isDeadTokenError } from "@/lib/slack-connect";
import { isKeptSlackMessage, slackMessageText, slackMessageUserId, slackTsToIso } from "@/lib/slack-messages";
import { clock } from "@/lib/clock";

/**
 * Slack 1:1 DMs, read with the member's own token (docs/SLACK_BRIDGED_CHAT.md, "Slack 1:1 DMs through members'
 * own tokens"). The bot can't be in a DM, so this is the only way they reach the Hub: list the member's DMs,
 * store them in Bronze exactly like channel messages, and project them into chat as direct messages (kind
 * 'dm', private, restricted: staff only through break-glass access). Idempotent: Bronze is keyed on
 * (channel, ts), and both people in a DM see the same Slack channel id, so two connected members share one copy.
 * Service role. Behind the `slack_dm_bridge` feature (the caller checks it per member).
 */

/** At most one pull of a member's DMs per this many seconds, however often they open chat. */
export const SLACK_DM_PULL_INTERVAL_SECONDS = 300;
/** Slack's free plan serves about 90 days of history; the first pull of a DM goes back that far. */
const FIRST_PULL_DAYS = 90;
const PAGE_SIZE = 200;
/** Pages of history per DM per pull: 2,000 messages. A busier DM catches up over the next pulls (oldest first). */
const MAX_PAGES = 10;
/** Messages projected into the chat at once, and in total per pull; the full projection (/api/process/chat) covers the rest. */
const PROJECT_CONCURRENCY = 5;
const MAX_PROJECTED = 500;

export interface DmPullResult {
  conversations: number;
  messages: number;
}

const errorCode = (error: unknown): string | undefined => (error as { data?: { error?: string } } | null)?.data?.error;
const isRateLimited = (error: unknown): boolean => (error as { code?: string } | null)?.code === "slack_webapi_rate_limited_error";

interface SlackIm {
  id: string;
  /** The other person's Slack user id. */
  user?: string;
  is_user_deleted?: boolean;
  created?: number;
}

/**
 * Pulls one member's DMs from Slack into Bronze and the chat. Returns null when nothing was done: not
 * production (like every read or write of the real workspace), no connection with the DM scopes, or pulled
 * within the interval. A dead token revokes the connection; a rate limit or a missing scope stops the pull
 * (the next one retries); one DM failing is logged and the others go on.
 */
export async function pullMemberDms(service: SupabaseClient, memberId: string): Promise<DmPullResult | null> {
  if (!chatSlackWritesEnabled()) return null;
  const status = await getSlackConnectionStatus(service, memberId);
  if (!status.connected || !status.hasDmScopes || !status.slackUserId) return null;
  const { data: claimed } = await service.rpc("chat_claim_slack_dm_pull", { p_member: memberId, p_min_seconds: SLACK_DM_PULL_INTERVAL_SECONDS });
  if (!claimed) return null;
  const connection = await getSlackUserToken(service, memberId);
  if (!connection) return null;

  const repos = createRepos(service);
  // Fail fast on a rate limit instead of sleeping inside a request.
  const slack = new WebClient(connection.token, { rejectRateLimitedCalls: true, retryConfig: { retries: 0 } });
  const result: DmPullResult = { conversations: 0, messages: 0 };
  try {
    const ims: SlackIm[] = [];
    let cursor: string | undefined;
    do {
      const page = await slack.conversations.list({ types: "im", limit: PAGE_SIZE, cursor, exclude_archived: false });
      ims.push(...((page.channels ?? []) as SlackIm[]).filter((c) => c.id));
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);

    for (const im of ims) {
      // Slackbot's "DM" is Slack's own, and a deactivated person's can't change.
      if (!im.user || im.user === "USLACKBOT" || im.is_user_deleted) continue;
      try {
        result.messages += await pullOneDm(service, repos, slack, { memberId, selfSlackId: connection.slackUserId, im });
        result.conversations += 1;
      } catch (error) {
        if (isDeadTokenError(error) || isRateLimited(error) || errorCode(error) === "missing_scope") throw error;
        console.error("pullMemberDms failed for a DM of member %s:", memberId, error);
      }
    }
  } catch (error) {
    if (isDeadTokenError(error)) await service.rpc("slack_connection_revoke", { p_member: memberId });
    else if (isRateLimited(error) || errorCode(error) === "missing_scope") console.warn("pullMemberDms stopped for member %s: %s", memberId, errorCode(error) ?? "rate limited");
    else console.error("pullMemberDms failed for member %s:", memberId, error);
  }
  return result;
}

async function pullOneDm(
  service: SupabaseClient,
  repos: ReturnType<typeof createRepos>,
  slack: WebClient,
  opts: { memberId: string; selfSlackId: string; im: SlackIm }
): Promise<number> {
  const { memberId, selfSlackId, im } = opts;
  const otherSlackId = im.user as string;
  const now = new Date(clock.now()).toISOString();

  // The conversation and its two participants in Bronze, then in the chat (the Hub members among them).
  await repos.slackWorkspace.upsertChannels([
    {
      channel_id: im.id,
      name: "",
      is_private: true,
      is_mpim: false,
      is_im: true,
      im_user_id: otherSlackId,
      is_archived: false,
      member_count: 2,
      created: im.created ? new Date(im.created * 1000).toISOString() : null,
      raw_payload: im as never,
      imported_at: now,
    },
  ]);
  await repos.slackWorkspace.upsertMemberships(
    [selfSlackId, otherSlackId].map((user_id) => ({ channel_id: im.id, user_id, left_at: null, imported_at: now }))
  );
  const others = await repos.chat.memberIdsBySlackUser([otherSlackId]);
  const people: Record<string, string> = { [selfSlackId]: memberId };
  const otherMember = others.get(otherSlackId);
  if (otherMember) people[otherSlackId] = otherMember;
  const { data: projected, error } = await service.rpc("project_slack_dm", { p_channel_id: im.id, p_members: people });
  if (error) throw new Error(error.message);
  const chatChannelId = (projected as { channel?: string | null } | null)?.channel;
  if (!chatChannelId) return 0;

  // Everything newer than what the chat already has; the first pull goes back as far as Slack serves.
  const newest = await repos.chat.newestSlackTs(chatChannelId, now).catch(() => null);
  const oldest = newest ?? String(Math.floor(clock.now() / 1000) - FIRST_PULL_DAYS * 86400);
  const fresh: { ts: string }[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const history = await slack.conversations.history({ channel: im.id, oldest, limit: PAGE_SIZE, cursor, inclusive: false });
    const messages = ((history.messages ?? []) as Record<string, any>[]).filter((m) => typeof m.ts === "string" && isKeptSlackMessage(m));
    await repos.slackMessages.upsertMessages(
      messages.map((m) => ({
        channel_id: im.id,
        message_ts: m.ts,
        user_id: slackMessageUserId(m),
        text: slackMessageText(m),
        message_type: m.subtype || "message",
        thread_ts: m.thread_ts || null,
        occurred_at: slackTsToIso(m.ts),
        files: m.files ?? null,
        has_files: Array.isArray(m.files) && m.files.length > 0,
        channel_type: "im",
        raw_payload: m as never,
      }))
    );
    fresh.push(...messages.map((m) => ({ ts: m.ts as string })));
    cursor = history.response_metadata?.next_cursor || undefined;
    if (!history.has_more || !cursor) break;
  }

  // Into the chat, oldest first so a thread's root is there before its replies.
  const toProject = fresh.sort((a, b) => Number(a.ts) - Number(b.ts)).slice(0, MAX_PROJECTED);
  const queue = [...toProject];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const { error: projectError } = await service.rpc("project_slack_chat_message", { p_channel_id: im.id, p_message_ts: item.ts });
      if (projectError) console.error("project_slack_chat_message failed for a DM message:", projectError.message);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PROJECT_CONCURRENCY, queue.length) }, worker));
  return fresh.length;
}
