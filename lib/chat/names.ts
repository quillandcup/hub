import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import { safeUrl } from "@/lib/url";
import { unicodeEmoji, type CustomEmoji } from "@/lib/chat/emoji";
import { cachedLookup } from "@/lib/chat/lookup-cache";
import { mentionedChannelIds, mentionedUserIds, mentionsToPlainText } from "@/lib/chat/render";

/**
 * Names for Slack authors and mentions that the signed-in member can't read themselves:
 * bronze.slack_users and the Slack-user-to-member map are service role only. Each function
 * returns only what the page then shows (a display name, or which Slack user wrote a message
 * the caller's own RLS-checked query already returned), never raw rows.
 */

const BATCH = 200;

/** The rows of a result, or a throw on a database error so a failed lookup is never cached as empty. */
function ok<T>(result: { data: T[] | null; error?: { message: string } | null }): T[] {
  if (result.error) throw new Error(result.error.message);
  return result.data ?? [];
}

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += BATCH) out.push(items.slice(i, i + BATCH));
  return out;
}

/**
 * Slack user id -> the name to show for a mention: the member's chosen Hub display name, else the
 * name they go by in Slack, else their Hub name, else their Slack real name. (A mention reads as it
 * does in Slack; the Hub's legal-style name only fills in when nothing else is set.)
 */
async function slackUserNamesUncached(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const names: Record<string, string> = {};
  if (ids.length === 0) return names;
  const repos = createRepos(createServiceRoleClient());

  for (const batch of chunks(ids)) {
    const [authors, slackUsers] = await Promise.all([repos.chat.memberIdsBySlackUser(batch), repos.slackUsers.byIds(batch)]);

    const memberIds = [...new Set(authors.values())];
    const memberNames = new Map<string, { name: string; displayName: string | null }>();
    if (memberIds.length > 0) {
      for (const m of await repos.directory.byIds(memberIds)) memberNames.set(m.id, { name: m.name, displayName: m.display_name });
    }
    const memberBySlackUser = new Map([...authors].map(([slackUserId, memberId]) => [slackUserId, memberNames.get(memberId)]));
    for (const u of slackUsers ?? []) {
      const member = memberBySlackUser.get(u.user_id);
      names[u.user_id] = member?.displayName || u.display_name || member?.name || u.real_name || u.name || "";
    }
    for (const [slackUserId, member] of memberBySlackUser) {
      if (!names[slackUserId] && member) names[slackUserId] = member.displayName || member.name;
    }
  }
  for (const id of ids) if (!names[id]) delete names[id];
  return names;
}

/**
 * Slack user id -> the person's Hub name (their chosen display name, else their name), for the people we have
 * matched. A notice about someone joining or leaving names them as the Hub does everywhere else, not by the
 * short name they go by in Slack ("Cody" for Cody Ray).
 */
async function slackUserHubNamesUncached(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const repos = createRepos(createServiceRoleClient());
  for (const batch of chunks(ids)) {
    const authors = await repos.chat.memberIdsBySlackUser(batch);
    const memberIds = [...new Set(authors.values())];
    if (memberIds.length === 0) continue;
    const members = await repos.directory.byIds(memberIds);
    const byMember = new Map(members.map((m) => [m.id, m.display_name || m.name]));
    for (const [slackUserId, memberId] of authors) {
      const name = byMember.get(memberId);
      if (name) out[slackUserId] = name;
    }
  }
  return out;
}

/** Slack user id -> Hub member id, for the people we have matched, so a mention can link to a profile. */
async function slackUserMemberIdsUncached(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const chat = createRepos(createServiceRoleClient()).chat;
  for (const batch of chunks(ids)) {
    for (const [slackUserId, memberId] of await chat.memberIdsBySlackUser(batch)) out[slackUserId] = memberId;
  }
  return out;
}

/** Slack channel id -> name for public channels, for <#C123> links whose text carries no name. */
async function slackChannelNamesUncached(channelIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(channelIds)];
  const out: Record<string, string> = {};
  if (ids.length === 0) return out;
  const service = createServiceRoleClient();
  for (const batch of chunks(ids)) {
    const data = ok(await service
      .schema("bronze")
      .from("slack_channels")
      .select("channel_id, name")
      .in("channel_id", batch)
      .eq("is_private", false));
    for (const c of data ?? []) if (c.name) out[c.channel_id] = c.name;
  }
  return out;
}

/**
 * Slack user id -> profile photo URL, for the people we can show one for: a matched member's Hub
 * photo, else the real (uploaded) photo from their Slack profile. Others are left out, and the
 * chat shows initials.
 */
async function slackUserPhotosUncached(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const photos: Record<string, string> = {};
  if (ids.length === 0) return photos;
  const repos = createRepos(createServiceRoleClient());

  for (const batch of chunks(ids)) {
    const [authors, slackUsers] = await Promise.all([repos.chat.memberIdsBySlackUser(batch), repos.slackUsers.byIds(batch)]);
    const memberIds = [...new Set(authors.values())];
    const memberPhotos = new Map<string, string>();
    if (memberIds.length > 0) {
      for (const m of await repos.directory.byIds(memberIds)) {
        const url = safeUrl(m.photo_url);
        if (url) memberPhotos.set(m.id, url);
      }
    }
    for (const [slackUserId, memberId] of authors) {
      const url = memberPhotos.get(memberId);
      if (url) photos[slackUserId] = url;
    }
    for (const u of slackUsers ?? []) {
      const url = safeUrl(u.image_url);
      if (url && !photos[u.user_id]) photos[u.user_id] = url;
    }
  }
  return photos;
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

const ALIAS_DEPTH = 5;

export const slackUserNames = cachedLookup("slack-user-names", slackUserNamesUncached);
export const slackUserHubNames = cachedLookup("slack-user-hub-names", slackUserHubNamesUncached);
export const slackUserMemberIds = cachedLookup("slack-user-member-ids", slackUserMemberIdsUncached);
export const slackChannelNames = cachedLookup("slack-channel-names", slackChannelNamesUncached);
export const slackUserPhotos = cachedLookup("slack-user-photos", slackUserPhotosUncached);
export const customEmojiFor = cachedLookup("custom-emoji", customEmojiUncached);

/**
 * Custom emoji by name, for the names a page shows. bronze.slack_custom_emoji is admin-read only
 * under RLS, but the emoji are public workspace decoration, so this returns just name -> image
 * (aliases followed, to a custom image or a standard emoji). Names that are not custom are left out.
 */
async function customEmojiUncached(names: string[]): Promise<Record<string, CustomEmoji>> {
  let wanted = [...new Set(names)];
  const rows = new Map<string, { image_url: string | null; alias_for: string | null }>();
  if (wanted.length === 0) return {};
  const service = createServiceRoleClient();

  // Aliases point at other names, which may be custom too: fetch until nothing new turns up.
  for (let depth = 0; depth < ALIAS_DEPTH && wanted.length > 0; depth++) {
    const next = new Set<string>();
    for (const batch of chunks(wanted)) {
      const data = ok(await service
        .schema("bronze")
        .from("slack_custom_emoji")
        .select("name, image_url, alias_for")
        .in("name", batch)
        .is("deleted_at", null));
      for (const r of data ?? []) {
        rows.set(r.name, r);
        if (r.alias_for && !rows.has(r.alias_for)) next.add(r.alias_for);
      }
    }
    wanted = [...next];
  }

  const out: Record<string, CustomEmoji> = {};
  for (const name of new Set(names)) {
    let current = name;
    for (let i = 0; i <= ALIAS_DEPTH; i++) {
      const row = rows.get(current);
      if (!row) {
        const text = i > 0 ? unicodeEmoji(current) : null;
        if (text) out[name] = { text };
        break;
      }
      if (row.image_url) {
        out[name] = { url: row.image_url };
        break;
      }
      if (!row.alias_for) break;
      current = row.alias_for;
    }
  }
  return out;
}

/** Rows whose `description` was stored as raw Slack text, with <@U123> / <#C123> turned into names. */
export async function withMentionNames<T extends { description?: string | null }>(rows: T[]): Promise<T[]> {
  const texts = rows.map((r) => r.description ?? "");
  const users = texts.flatMap(mentionedUserIds);
  const channels = texts.flatMap(mentionedChannelIds);
  if (users.length === 0 && channels.length === 0) return rows;
  const [userNames, channelNames] = await Promise.all([slackUserNames(users), slackChannelNames(channels)]);
  return rows.map((r) => (r.description ? { ...r, description: mentionsToPlainText(r.description, { userNames, channelNames }) } : r));
}
