import type { WebClient } from "@slack/web-api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { clock } from "@/lib/clock";
import { fetchAllBronzeRows } from "@/lib/supabase/bronze-pagination";

/**
 * The parts of the Slack import that capture more than messages: group DMs the
 * bot is in, who is in each conversation, custom emoji, and message files.
 *
 * On Slack's free plan anything not copied while Slack still has it is gone
 * (about 90 days through the API), so each of these is pulled on every import.
 * The webhook handles the same things as they happen, but the pull is the
 * guaranteed path (CLAUDE.md, "Nothing through webhooks alone").
 *
 * Group DMs and emoji need scopes (mpim:read, emoji:read) that are only granted
 * once the app is reinstalled after a manifest change. Until then Slack answers
 * missing_scope; that part is skipped with a warning instead of failing the
 * whole import.
 */

const isMissingScope = (error: any) => error?.data?.error === "missing_scope";

export interface SlackChannelRow {
  channel_id: string;
  name: string;
  is_private: boolean;
  is_mpim: boolean;
  is_archived: boolean;
  member_count: number;
  topic: string | null;
  purpose: string | null;
  created: string | null;
  raw_payload: any;
}

export function toSlackChannelRow(c: any): SlackChannelRow {
  return {
    channel_id: c.id,
    name: c.name,
    is_private: c.is_private || c.is_mpim || false,
    is_mpim: c.is_mpim || false,
    is_archived: c.is_archived || false,
    member_count: c.num_members || 0,
    topic: c.topic?.value || null,
    purpose: c.purpose?.value || null,
    created: c.created ? new Date(c.created * 1000).toISOString() : null,
    raw_payload: c,
  };
}

/** How bronze.slack_messages.channel_type names a conversation. */
export function slackChannelType(channel: { is_private: boolean; is_mpim: boolean }): string {
  if (channel.is_mpim) return "mpim";
  return channel.is_private ? "private_channel" : "public_channel";
}

/**
 * Group DMs the bot is in. Listed separately from channels: one
 * conversations.list call fails as a whole if the token lacks the scope for
 * any requested type.
 */
export async function fetchGroupDms(slack: WebClient): Promise<{ channels: SlackChannelRow[]; skipped: string | null }> {
  const channels: SlackChannelRow[] = [];
  let cursor: string | undefined;
  try {
    do {
      const result: any = await slack.conversations.list({ cursor, limit: 200, types: "mpim", exclude_archived: false });
      channels.push(...(result.channels ?? []).map(toSlackChannelRow));
      cursor = result.response_metadata?.next_cursor;
    } while (cursor);
  } catch (error: any) {
    if (!isMissingScope(error)) throw error;
    console.warn("  Skipping group DMs: the Slack app needs the mpim:read scope (reinstall after the manifest change)");
    return { channels: [], skipped: "missing_scope" };
  }
  return { channels, skipped: null };
}

export interface MembershipSyncResult {
  channelsSynced: number;
  channelsFailed: number;
  members: number;
  left: number;
}

const MEMBERS_CONCURRENCY = 4;
const WRITE_BATCH = 500;

/**
 * Mirror each conversation's member list into bronze.slack_channel_members.
 *
 * Present members are upserted with left_at cleared. A stored member missing
 * from the list gets left_at (soft delete), but only for channels whose list
 * was fetched completely: a failed call must not read as everyone leaving.
 */
export async function syncChannelMembers(
  supabase: SupabaseClient,
  slack: WebClient,
  channels: { channel_id: string; name: string; is_archived: boolean }[],
  importTimestamp: string
): Promise<MembershipSyncResult> {
  const result: MembershipSyncResult = { channelsSynced: 0, channelsFailed: 0, members: 0, left: 0 };
  // conversations.members fails on archived channels the bot can no longer read.
  const queue = channels.filter((c) => !c.is_archived);
  const fetched = new Map<string, string[]>();

  const worker = async () => {
    for (let channel = queue.shift(); channel; channel = queue.shift()) {
      try {
        const members: string[] = [];
        let cursor: string | undefined;
        do {
          const page: any = await slack.conversations.members({ channel: channel.channel_id, cursor, limit: 200 });
          members.push(...(page.members ?? []));
          cursor = page.response_metadata?.next_cursor;
        } while (cursor);
        fetched.set(channel.channel_id, members);
      } catch (error: any) {
        result.channelsFailed++;
        console.warn(`  Could not list members of #${channel.name}: ${error?.data?.error || error?.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: MEMBERS_CONCURRENCY }, worker));
  if (fetched.size === 0) return result;

  const stored: { channel_id: string; user_id: string; left_at: string | null }[] = await fetchAllBronzeRows(
    supabase,
    "slack_channel_members",
    "channel_id, user_id, left_at",
    (q) => q.order("channel_id").order("user_id")
  );
  const storedByChannel = new Map<string, Map<string, string | null>>();
  for (const row of stored) {
    if (!storedByChannel.has(row.channel_id)) storedByChannel.set(row.channel_id, new Map());
    storedByChannel.get(row.channel_id)!.set(row.user_id, row.left_at);
  }

  // Only rows that change are written: a new member, or one who came back.
  const toUpsert: { channel_id: string; user_id: string; left_at: null; imported_at: string }[] = [];
  const toMarkLeft: { channel_id: string; user_ids: string[] }[] = [];
  for (const [channelId, members] of fetched) {
    const known = storedByChannel.get(channelId) ?? new Map<string, string | null>();
    const present = new Set(members);
    for (const userId of present) {
      if (!known.has(userId) || known.get(userId) !== null) {
        toUpsert.push({ channel_id: channelId, user_id: userId, left_at: null, imported_at: importTimestamp });
      }
    }
    const gone = [...known].filter(([userId, leftAt]) => leftAt === null && !present.has(userId)).map(([userId]) => userId);
    if (gone.length > 0) toMarkLeft.push({ channel_id: channelId, user_ids: gone });
    result.members += present.size;
    result.left += gone.length;
  }

  for (let i = 0; i < toUpsert.length; i += WRITE_BATCH) {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_channel_members")
      .upsert(toUpsert.slice(i, i + WRITE_BATCH), { onConflict: "channel_id,user_id" });
    if (error) throw error;
  }
  for (const { channel_id, user_ids } of toMarkLeft) {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_channel_members")
      .update({ left_at: importTimestamp, imported_at: importTimestamp })
      .eq("channel_id", channel_id)
      .in("user_id", user_ids);
    if (error) throw error;
  }

  result.channelsSynced = fetched.size;
  return result;
}

export interface EmojiSyncResult {
  emoji: number;
  removed: number;
  skipped: string | null;
}

/** Slack's emoji.list value: an image URL, or "alias:<name>". */
export function toCustomEmojiRow(name: string, value: string) {
  const alias = value.startsWith("alias:") ? value.slice("alias:".length) : null;
  return { name, image_url: alias ? null : value, alias_for: alias, removed_at: null };
}

/**
 * Mirror the workspace's custom emoji into bronze.slack_custom_emoji.
 * emoji.list is the whole set in one call, so a stored emoji missing from a
 * successful response has been removed (soft delete).
 */
export async function syncCustomEmoji(
  supabase: SupabaseClient,
  slack: WebClient,
  importTimestamp: string
): Promise<EmojiSyncResult> {
  let emoji: Record<string, string>;
  try {
    const response: any = await slack.emoji.list();
    emoji = response.emoji ?? {};
  } catch (error: any) {
    if (!isMissingScope(error)) throw error;
    console.warn("  Skipping custom emoji: the Slack app needs the emoji:read scope (reinstall after the manifest change)");
    return { emoji: 0, removed: 0, skipped: "missing_scope" };
  }

  const rows = Object.entries(emoji).map(([name, value]) => ({ ...toCustomEmojiRow(name, value), imported_at: importTimestamp }));
  for (let i = 0; i < rows.length; i += WRITE_BATCH) {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_custom_emoji")
      .upsert(rows.slice(i, i + WRITE_BATCH), { onConflict: "name" });
    if (error) throw error;
  }

  const stored: { name: string }[] = await fetchAllBronzeRows(supabase, "slack_custom_emoji", "name", (q) =>
    q.is("removed_at", null).order("name")
  );
  const gone = stored.map((r) => r.name).filter((name) => !(name in emoji));
  for (let i = 0; i < gone.length; i += 100) {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_custom_emoji")
      .update({ removed_at: importTimestamp, imported_at: importTimestamp })
      .in("name", gone.slice(i, i + 100));
    if (error) throw error;
  }

  return { emoji: rows.length, removed: gone.length, skipped: null };
}

// ---------------------------------------------------------------------------
// Webhook events (the same changes, as they happen)
// ---------------------------------------------------------------------------

/** member_joined_channel / member_left_channel. */
export async function applySlackMembershipEvent(
  supabase: SupabaseClient,
  event: { type: string; channel?: string; user?: string }
): Promise<void> {
  if (!event.channel || !event.user) return;
  const now = new Date(clock.now()).toISOString();

  if (event.type === "member_joined_channel") {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_channel_members")
      .upsert(
        { channel_id: event.channel, user_id: event.user, left_at: null, imported_at: now },
        { onConflict: "channel_id,user_id" }
      );
    if (error) throw error;
  } else if (event.type === "member_left_channel") {
    const { error } = await supabase
      .schema("bronze")
      .from("slack_channel_members")
      .update({ left_at: now, imported_at: now })
      .eq("channel_id", event.channel)
      .eq("user_id", event.user)
      .is("left_at", null);
    if (error) throw error;
  }
}

/**
 * emoji_changed: subtype add ({name, value}), remove ({names}) or rename
 * ({old_name, new_name, value}). Without a subtype Slack only says "something
 * changed"; the next import's emoji.list picks that up.
 */
export async function applySlackEmojiEvent(
  supabase: SupabaseClient,
  event: { subtype?: string; name?: string; value?: string; names?: string[]; old_name?: string; new_name?: string }
): Promise<void> {
  const now = new Date(clock.now()).toISOString();
  const table = () => supabase.schema("bronze").from("slack_custom_emoji");
  const add = async (name: string, value: string) => {
    const { error } = await table().upsert({ ...toCustomEmojiRow(name, value), imported_at: now }, { onConflict: "name" });
    if (error) throw error;
  };
  const remove = async (names: string[]) => {
    if (names.length === 0) return;
    const { error } = await table().update({ removed_at: now, imported_at: now }).in("name", names).is("removed_at", null);
    if (error) throw error;
  };

  if (event.subtype === "add" && event.name && event.value) {
    await add(event.name, event.value);
  } else if (event.subtype === "remove") {
    await remove(event.names ?? []);
  } else if (event.subtype === "rename" && event.old_name && event.new_name) {
    if (event.value) await add(event.new_name, event.value);
    await remove([event.old_name]);
  }
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export const SLACK_FILES_BUCKET = "slack-files";
/** Larger files stay in Slack only: the function holds each file in memory. */
export const MAX_SLACK_FILE_BYTES = 20 * 1024 * 1024;

export interface SlackFileRow {
  file_id: string;
  channel_id: string;
  message_ts: string;
  name: string | null;
  mimetype: string | null;
  size_bytes: number | null;
  raw_payload: any;
}

/** One row per file attached to the given messages (first message wins). */
export function slackFilesFromMessages(messages: { channel_id: string; message_ts: string; files?: any[] | null }[]): SlackFileRow[] {
  const byId = new Map<string, SlackFileRow>();
  for (const m of messages) {
    for (const f of m.files ?? []) {
      if (!f?.id || byId.has(f.id)) continue;
      byId.set(f.id, {
        file_id: f.id,
        channel_id: m.channel_id,
        message_ts: m.message_ts,
        name: f.name ?? f.title ?? null,
        mimetype: f.mimetype ?? null,
        size_bytes: typeof f.size === "number" ? f.size : null,
        raw_payload: f,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Why a file can't be copied at all, or null if it can. These never change,
 * so the file is marked and not tried again.
 */
export function slackFileSkipReason(file: { size_bytes: number | null; raw_payload: any }): string | null {
  const raw = file.raw_payload ?? {};
  if (raw.mode === "tombstone") return "skipped: deleted in Slack";
  if (raw.mode === "hidden_by_limit") return "skipped: hidden by Slack's history limit";
  if (raw.mode === "external" || raw.is_external) return "skipped: hosted outside Slack";
  if (!raw.url_private_download && !raw.url_private) return "skipped: no download URL";
  if ((file.size_bytes ?? 0) > MAX_SLACK_FILE_BYTES) return "skipped: larger than 20 MB";
  return null;
}

export function slackFileStoragePath(file: { file_id: string; name: string | null }): string {
  const safeName = (file.name || "file").replace(/[^A-Za-z0-9._-]+/g, "_").slice(-120) || "file";
  return `${file.file_id}/${safeName}`;
}

export interface FileCopyResult {
  seen: number;
  copied: number;
  skipped: number;
  failed: number;
  pending: number;
}

/**
 * Record the files on the given messages, then copy uncopied files into the
 * private slack-files bucket until `deadline` (a clock.now() value). Oldest
 * first: those are the next to fall out of Slack's history. Whatever doesn't
 * fit, or fails to download, is still pending on the next import.
 *
 * `storage` must be a service-role client: the bucket has no policies.
 */
export async function copySlackFiles(
  storage: SupabaseClient,
  botToken: string,
  messages: { channel_id: string; message_ts: string; files?: any[] | null }[],
  importTimestamp: string,
  deadline: number,
  download: typeof fetch = fetch
): Promise<FileCopyResult> {
  const result: FileCopyResult = { seen: 0, copied: 0, skipped: 0, failed: 0, pending: 0 };

  const seen = slackFilesFromMessages(messages);
  result.seen = seen.length;
  for (let i = 0; i < seen.length; i += WRITE_BATCH) {
    // ignoreDuplicates: never overwrite a row that already has its storage_path.
    const { error } = await storage
      .schema("bronze")
      .from("slack_files")
      .upsert(seen.slice(i, i + WRITE_BATCH).map((f) => ({ ...f, imported_at: importTimestamp })), {
        onConflict: "file_id",
        ignoreDuplicates: true,
      });
    if (error) throw error;
  }

  const pending: (SlackFileRow & { copy_error: string | null })[] = await fetchAllBronzeRows(
    storage,
    "slack_files",
    "file_id, channel_id, message_ts, name, mimetype, size_bytes, copy_error, raw_payload",
    (q) => q.is("storage_path", null).order("message_ts").order("file_id")
  );
  const todo = pending.filter((f) => !f.copy_error?.startsWith("skipped:"));

  const mark = async (fileId: string, fields: Record<string, unknown>) => {
    const { error } = await storage.schema("bronze").from("slack_files").update(fields).eq("file_id", fileId);
    if (error) throw error;
  };

  let remaining = todo.length;
  for (const file of todo) {
    if (clock.now() >= deadline) break;
    remaining--;

    const skipReason = slackFileSkipReason(file);
    if (skipReason) {
      await mark(file.file_id, { copy_error: skipReason });
      result.skipped++;
      continue;
    }

    try {
      const url = file.raw_payload.url_private_download || file.raw_payload.url_private;
      const response = await download(url, { headers: { Authorization: `Bearer ${botToken}` } });
      if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
      // Without access Slack answers 200 with its sign-in page instead of the file.
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.startsWith("text/html") && !(file.mimetype ?? "").startsWith("text/html")) {
        throw new Error("Slack returned a sign-in page instead of the file");
      }
      const body = await response.arrayBuffer();
      if (body.byteLength > MAX_SLACK_FILE_BYTES) {
        await mark(file.file_id, { copy_error: "skipped: larger than 20 MB" });
        result.skipped++;
        continue;
      }

      const path = slackFileStoragePath(file);
      const { error: uploadError } = await storage.storage
        .from(SLACK_FILES_BUCKET)
        .upload(path, body, { contentType: file.mimetype || "application/octet-stream", upsert: true });
      if (uploadError) throw uploadError;

      await mark(file.file_id, { storage_path: path, copied_at: new Date(clock.now()).toISOString(), copy_error: null });
      result.copied++;
    } catch (error: any) {
      // Left pending: retried on the next import.
      await mark(file.file_id, { copy_error: String(error?.message ?? error).slice(0, 300) });
      result.failed++;
    }
  }

  result.pending = remaining + result.failed;
  return result;
}
