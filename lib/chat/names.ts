import { createServiceRoleClient } from "@/lib/supabase/service";
import { safeUrl } from "@/lib/url";
import { unicodeEmoji, type CustomEmoji } from "@/lib/chat/emoji";

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

/**
 * Slack user id -> profile photo URL, for the people we can show one for: a matched member's Hub
 * photo, else the real (uploaded) photo from their Slack profile. Others are left out, and the
 * chat shows initials.
 */
export async function slackUserPhotos(userIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(userIds)];
  const photos: Record<string, string> = {};
  if (ids.length === 0) return photos;
  const service = createServiceRoleClient();

  for (const batch of chunks(ids)) {
    const [{ data: authors }, { data: slackUsers }] = await Promise.all([
      service.from("chat_slack_authors").select("slack_user_id, member_id").in("slack_user_id", batch),
      service.schema("bronze").from("slack_users").select("user_id, image_url").in("user_id", batch),
    ]);
    const memberIds = [...new Set((authors ?? []).map((a) => a.member_id))];
    const memberPhotos = new Map<string, string>();
    if (memberIds.length > 0) {
      const { data: members } = await service.from("member_directory").select("id, photo_url").in("id", memberIds);
      for (const m of members ?? []) {
        const url = safeUrl(m.photo_url);
        if (url) memberPhotos.set(m.id, url);
      }
    }
    for (const a of authors ?? []) {
      const url = memberPhotos.get(a.member_id);
      if (url) photos[a.slack_user_id] = url;
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

/**
 * Custom emoji by name, for the names a page shows. bronze.slack_custom_emoji is admin-read only
 * under RLS, but the emoji are public workspace decoration, so this returns just name -> image
 * (aliases followed, to a custom image or a standard emoji). Names that are not custom are left out.
 */
export async function customEmojiFor(names: string[]): Promise<Record<string, CustomEmoji>> {
  let wanted = [...new Set(names)];
  const rows = new Map<string, { image_url: string | null; alias_for: string | null }>();
  if (wanted.length === 0) return {};
  const service = createServiceRoleClient();

  // Aliases point at other names, which may be custom too: fetch until nothing new turns up.
  for (let depth = 0; depth < ALIAS_DEPTH && wanted.length > 0; depth++) {
    const next = new Set<string>();
    for (const batch of chunks(wanted)) {
      const { data } = await service
        .schema("bronze")
        .from("slack_custom_emoji")
        .select("name, image_url, alias_for")
        .in("name", batch)
        .is("deleted_at", null);
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
