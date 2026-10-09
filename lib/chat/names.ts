import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Names for Slack authors and mentions that the signed-in member can't read themselves:
 * bronze.slack_users and the Slack-user-to-member map are service role only. Each function
 * returns only what the page then shows (a display name, or which Slack user wrote a message
 * the caller's own RLS-checked query already returned), never raw rows.
 */

const BATCH = 200;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/** Slack user id -> display name. A member's Hub name when we know who they are, else their Slack name. */
export async function slackUserNames(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const names: Record<string, string> = {};
  if (ids.length === 0) return names;
  const service = createServiceRoleClient();

  for (const batch of chunks(ids)) {
    const [{ data: authors }, { data: slackUsers }] = await Promise.all([
      service.from("chat_slack_authors").select("slack_user_id, member_id").in("slack_user_id", batch),
      service.schema("bronze").from("slack_users").select("user_id, display_name, real_name, name").in("user_id", batch),
    ]);

    const memberIds = [...new Set((authors ?? []).map((a) => a.member_id))];
    const memberNames = new Map<string, string>();
    if (memberIds.length > 0) {
      const { data: members } = await service.from("member_directory").select("id, name, display_name").in("id", memberIds);
      for (const m of members ?? []) memberNames.set(m.id, m.display_name || m.name);
    }
    for (const a of authors ?? []) {
      const name = memberNames.get(a.member_id);
      if (name) names[a.slack_user_id] = name;
    }
    for (const u of slackUsers ?? []) {
      if (!names[u.user_id]) names[u.user_id] = u.display_name || u.real_name || u.name || "";
    }
  }
  for (const id of ids) if (!names[id]) delete names[id];
  return names;
}

/** For messages with no matched member: message ts -> the Slack user id that wrote it. */
export async function slackAuthorIdsByTs(slackChannelId: string, messageTs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (messageTs.length === 0) return out;
  const service = createServiceRoleClient();
  for (const batch of chunks(messageTs)) {
    const { data } = await service
      .schema("bronze")
      .from("slack_messages")
      .select("message_ts, user_id")
      .eq("channel_id", slackChannelId)
      .in("message_ts", batch);
    for (const row of data ?? []) out[row.message_ts] = row.user_id;
  }
  return out;
}
