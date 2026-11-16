import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRepos } from "@/lib/data/repos";
import type { SlackEmojiImage } from "@/lib/data/slack-workspace";
import { emojiPublicUrl } from "@/lib/chat/emoji-url";
import { safeUrl } from "@/lib/url";
import { slackPhotoUrl } from "@/lib/slack-avatar-url";
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
  const service = createServiceRoleClient();
  const repos = createRepos(service);

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
  const names = await createRepos(createServiceRoleClient()).slackWorkspace.publicChannelNames(ids);
  for (const [id, name] of names) out[id] = name;
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
  const service = createServiceRoleClient();
  const repos = createRepos(service);

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
      // Our copy once the sync has made one, Slack's address until then.
      const url = safeUrl(slackPhotoUrl(service, u));
      if (url && !photos[u.user_id]) photos[u.user_id] = url;
    }
  }
  return photos;
}

/** For messages with no matched member: message ts -> the Slack user id that wrote it. */
export async function slackAuthorIdsByTs(slackChannelId: string, messageTs: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (messageTs.length === 0) return out;
  const authors = await createRepos(createServiceRoleClient()).slackMessages.authorsByTs(slackChannelId, messageTs);
  for (const [ts, userId] of authors) out[ts] = userId;
  return out;
}

const ALIAS_DEPTH = 5;

export const slackUserNames = cachedLookup("slack-user-names", slackUserNamesUncached);
export const slackUserHubNames = cachedLookup("slack-user-hub-names", slackUserHubNamesUncached);
export const slackUserMemberIds = cachedLookup("slack-user-member-ids", slackUserMemberIdsUncached);
export const slackChannelNames = cachedLookup("slack-channel-names", slackChannelNamesUncached);
export const slackUserPhotos = cachedLookup("slack-user-photos", slackUserPhotosUncached);
export const customEmojiFor = cachedLookup("custom-emoji", customEmojiUncached);
const customEmojiNames = cachedLookup("custom-emoji-names", async () => ({
  all: await createRepos(createServiceRoleClient()).slackWorkspace.liveEmojiNames(),
}));

/** The names of every live custom emoji (cached like the other lookups), for the `:name` suggestions. */
export async function liveCustomEmojiNames(): Promise<string[]> {
  return (await customEmojiNames(["all"])).all ?? [];
}

/**
 * Custom emoji by name, for the names a page shows. bronze.slack_custom_emoji is admin-read only
 * under RLS, but the emoji are public workspace decoration, so this returns just name -> image
 * (aliases followed, to a custom image or a standard emoji). Names that are not custom are left out.
 */
async function customEmojiUncached(names: string[]): Promise<Record<string, CustomEmoji>> {
  let wanted = [...new Set(names)];
  const rows = new Map<string, SlackEmojiImage>();
  if (wanted.length === 0) return {};
  const service = createServiceRoleClient();
  const workspace = createRepos(service).slackWorkspace;

  // Aliases point at other names, which may be custom too: fetch until nothing new turns up.
  for (let depth = 0; depth < ALIAS_DEPTH && wanted.length > 0; depth++) {
    const next = new Set<string>();
    for (const r of await workspace.emojiByNames(wanted)) {
      rows.set(r.name, r);
      if (r.alias_for && !rows.has(r.alias_for)) next.add(r.alias_for);
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
      if (row.image_path) {
        // Our copy (CORS-readable, so it can be a still too); Slack's address until the sync has copied it.
        out[name] = { url: emojiPublicUrl(service, row.image_path), stored: true, ...(row.still_path ? { still: emojiPublicUrl(service, row.still_path) } : {}) };
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

/** How many other people a row names before the panel's "+N" (the panel shows the first few). */
const PARTICIPANTS_KEPT = 8;

/**
 * Activity rows for a DM or group DM, each given `data.participants`: the names of the others in that conversation
 * (the member whose page it is left out, unless nobody else is in it). Staff may see who is in every conversation,
 * never what was said (`/privacy`), so this reads membership and names only: a matched member by their Hub display
 * name, anyone else by their Slack name. Bots are skipped. Callers have already checked the caller is staff.
 */
export async function withConversationParticipants<T extends { data?: unknown }>(rows: T[], memberId: string): Promise<T[]> {
  const dataOf = (r: T): Record<string, unknown> | null => (r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : null);
  const channelIds = [
    ...new Set(
      rows.flatMap((r) => {
        const d = dataOf(r);
        return (d?.channel_type === "im" || d?.channel_type === "mpim") && typeof d.channel_id === "string" ? [d.channel_id] : [];
      }),
    ),
  ];
  if (channelIds.length === 0) return rows;
  const repos = createRepos(createServiceRoleClient());
  const participants = await repos.slackWorkspace.currentParticipants(channelIds);
  const userIds = [...new Set([...participants.values()].flat())];
  if (userIds.length === 0) return rows;

  const [authors, slackUsers] = await Promise.all([repos.chat.memberIdsBySlackUser(userIds), repos.slackUsers.byIds(userIds)]);
  const members = authors.size > 0 ? await repos.directory.byIds([...new Set(authors.values())]) : [];
  const hubName = new Map(members.map((m) => [m.id, m.display_name || m.name]));
  const profile = new Map(slackUsers.map((u) => [u.user_id, u]));

  const label = (id: string): string | null => {
    const u = profile.get(id);
    return (authors.get(id) && hubName.get(authors.get(id) as string)) || u?.display_name || u?.real_name || u?.name || null;
  };
  return rows.map((r) => {
    const data = dataOf(r);
    const channelId = data?.channel_id;
    const people = typeof channelId === "string" ? participants.get(channelId) : undefined;
    if (!people || !data) return r;
    const real = people.filter((id) => !profile.get(id)?.is_bot);
    const others = real.filter((id) => authors.get(id) !== memberId);
    const names = (others.length > 0 ? others : real).map(label).filter((n): n is string => !!n);
    return names.length === 0 ? r : { ...r, data: { ...data, participants: names.slice(0, PARTICIPANTS_KEPT), participantCount: names.length } };
  });
}
