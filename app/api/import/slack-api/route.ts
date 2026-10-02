import { WebClient } from '@slack/web-api';
import type { SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/api-auth';
import { extractSlackImageUrl } from '@/lib/member-avatar';
import { deleteRemovedSlackReactions } from '@/lib/slack-reactions';
import {
  isKeptSlackMessage,
  slackMessageUserId,
  slackTsToIso,
  threadKey,
  threadsNeedingReplies,
  type StoredThreadReplies,
} from '@/lib/slack-messages';

export const maxDuration = 300; // 5 minutes for Slack API calls

// Thread replies get whatever is left of this budget after channel history,
// leaving the rest of maxDuration for the upserts and Silver reprocessing.
// Threads that don't fit are fetched on the next run (see threadsNeedingReplies).
const FETCH_BUDGET_MS = 170_000;
// Replies to threads active this recently are refetched every run, to catch
// reactions added or removed on them.
const RECENT_THREAD_DAYS = 3;

interface SlackApiImportRequest {
  daysBack: number;
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (auth.forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { supabase } = auth;

  try {
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

    if (!SLACK_BOT_TOKEN) {
      return NextResponse.json(
        { error: "SLACK_BOT_TOKEN environment variable not configured" },
        { status: 500 }
      );
    }

    const startedAt = Date.now();
    const body: SlackApiImportRequest = await request.json();
    const daysBack = body.daysBack || 7;

    console.log(`Fetching ${daysBack} days of Slack data from API`);

    const slack = new WebClient(SLACK_BOT_TOKEN);

    // Calculate date range
    const oldest = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);
    const latest = Math.floor(Date.now() / 1000);

    console.log(`Date range: ${new Date(oldest * 1000).toISOString()} to ${new Date(latest * 1000).toISOString()}`);

    // 1. Fetch users
    const users = await fetchAllUsers(slack);
    console.log(`Fetched ${users.length} users`);

    // 2. Fetch channels
    const channels = await fetchAllChannels(slack);
    console.log(`Fetched ${channels.length} channels`);

    // 2.5. Auto-join public channels
    await autoJoinPublicChannels(slack, channels);

    // 3. Fetch messages and reactions
    console.log('Fetching messages...');
    const allMessages: any[] = [];
    const allReactions: any[] = [];

    for (const channel of channels) {
      console.log(`  Processing #${channel.name}...`);
      const { messages, reactions } = await fetchChannelHistory(
        slack,
        channel.channel_id,
        channel.name,
        channel.is_private ? 'private_channel' : 'public_channel',
        oldest,
        latest
      );
      allMessages.push(...messages);
      allReactions.push(...reactions);

      // Rate limit: ~50 channels/min
      await sleep(1200);
    }

    // conversations.history only returns top-level messages; replies (more than
    // half of all messages) need one conversations.replies call per thread, so
    // only threads that changed (or are still active) are fetched.
    const parents = allMessages.filter(m => m.reply_count > 0);
    const storedReplies = await loadStoredThreadReplies(supabase, parents);
    const threads = threadsNeedingReplies(parents, storedReplies, latest - RECENT_THREAD_DAYS * 24 * 60 * 60);
    console.log(`Fetching replies for ${threads.length} of ${parents.length} threads...`);
    const threadReplies = await fetchThreadReplies(slack, threads, startedAt + FETCH_BUDGET_MS);
    if (threadReplies.deferred > 0) {
      console.warn(`  Out of time: ${threadReplies.deferred} threads deferred to the next run`);
    }
    allMessages.push(...threadReplies.messages);
    allReactions.push(...threadReplies.reactions);

    // A thread_broadcast reply shows up in both history and its thread, and one
    // upsert statement can't touch the same row twice.
    dedupeBy(allMessages, m => `${m.channel_id}|${m.message_ts}`);
    dedupeBy(allReactions, r => `${r.channel_id}|${r.message_ts}|${r.reaction}|${r.user_id}`);

    console.log(`  Fetched ${allMessages.length} messages (${threadReplies.messages.length} thread replies), ${allReactions.length} reactions`);

    // 4. Fill in user details (email, name) from users map
    const usersById = new Map(users.map(u => [u.user_id, u]));

    for (const msg of allMessages) {
      const user = usersById.get(msg.user_id);
      if (user) {
        msg.user_email = user.email || '';
        msg.user_name = user.real_name || user.name || '';
      }
    }

    for (const reaction of allReactions) {
      const user = usersById.get(reaction.user_id);
      if (user) {
        reaction.user_email = user.email || '';
        reaction.user_name = user.real_name || user.name || '';
      }
    }

    // 5. UPSERT to Bronze tables (idempotent)
    const importTimestamp = new Date().toISOString();

    // Batched: a 90-day import (with thread replies) is thousands of messages
    // and 10k+ reactions, and one statement that size hits Postgres's
    // statement timeout when an admin runs the import from the page.
    await upsertInBatches(supabase, "slack_users", users.map(u => ({ ...u, imported_at: importTimestamp })), "user_id");
    await upsertInBatches(supabase, "slack_channels", channels.map(c => ({ ...c, imported_at: importTimestamp })), "channel_id");
    await upsertInBatches(supabase, "slack_messages", allMessages.map(m => ({ ...m, imported_at: importTimestamp })), "channel_id,message_ts");
    await upsertInBatches(supabase, "slack_reactions", allReactions.map(r => ({ ...r, imported_at: importTimestamp })), "channel_id,message_ts,reaction,user_id");

    // Upserts can't express "this reaction was taken back", so drop stored
    // reactions on the fetched messages that Slack no longer reports.
    const reactionsRemoved = await deleteRemovedSlackReactions(supabase, allMessages, allReactions);
    if (reactionsRemoved > 0) console.log(`  Removed ${reactionsRemoved} reactions no longer in Slack`);

    // Detect date range from imported messages
    let dateRange = null;
    if (allMessages.length > 0) {
      const dates = allMessages
        .map(m => m.occurred_at)
        .filter(d => d)
        .sort();

      if (dates.length > 0) {
        dateRange = {
          fromDate: dates[0].split('T')[0], // First message date (YYYY-MM-DD)
          toDate: dates[dates.length - 1].split('T')[0], // Last message date (YYYY-MM-DD)
        };
      }
    }

    // Auto-trigger Slack processing if we have a date range (wait for completion)
    const { triggerReprocessing } = await import('@/lib/processing/trigger');
    // Members read Slack users (avatars), so rebuild them before matching
    // messages; message and reaction changes alone never touch members.
    const processed: any[] = [];
    if (users.length > 0) {
      processed.push(...(await triggerReprocessing('slack_users', 'bronze')).processed);
    }
    if (dateRange) {
      console.log(`Triggering Slack processing for date range: ${dateRange.fromDate} to ${dateRange.toDate}`);
      const slackResults = await triggerReprocessing('slack_messages', 'bronze', {
        dateRange: {
          from: new Date(dateRange.fromDate),
          to: new Date(dateRange.toDate + 'T23:59:59Z')
        }
      });
      processed.push(...slackResults.processed);
    }

    return NextResponse.json({
      success: true,
      fetched: {
        users: users.length,
        channels: channels.length,
        messages: allMessages.length,
        threadReplies: threadReplies.messages.length,
        threadsFetched: threads.length - threadReplies.deferred,
        threadsDeferred: threadReplies.deferred,
        reactions: allReactions.length,
      },
      daysBack,
      imported: {
        users: users.length,
        channels: channels.length,
        messages: allMessages.length,
        reactions: allReactions.length,
        reactionsRemoved,
      },
      importTimestamp,
      dateRange,
      processing: processed,
    });
  } catch (error: any) {
    console.error("Error fetching from Slack API:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch from Slack API" },
      { status: 500 }
    );
  }
}

async function fetchAllUsers(slack: WebClient) {
  const users: any[] = [];
  let cursor: string | undefined;

  do {
    const result: any = await slack.users.list({ cursor, limit: 200 });

    if (result.members) {
      users.push(...result.members.map((u: any) => ({
        user_id: u.id,
        email: u.profile?.email || null,
        name: u.name,
        display_name: u.profile?.display_name || u.name,
        real_name: u.real_name,
        image_url: extractSlackImageUrl(u.profile),
        is_bot: u.is_bot || false,
        is_deleted: u.deleted || false,
        raw_payload: u
      })));
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return users;
}

async function fetchAllChannels(slack: WebClient) {
  const channels: any[] = [];
  let cursor: string | undefined;

  do {
    const result: any = await slack.conversations.list({
      cursor,
      limit: 200,
      types: 'public_channel,private_channel',
      exclude_archived: false
    });

    if (result.channels) {
      channels.push(...result.channels.map((c: any) => ({
        channel_id: c.id,
        name: c.name,
        is_private: c.is_private || false,
        is_archived: c.is_archived || false,
        member_count: c.num_members || 0,
        topic: c.topic?.value || null,
        purpose: c.purpose?.value || null,
        created: c.created ? new Date(c.created * 1000).toISOString() : null,
        raw_payload: c
      })));
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return channels;
}

async function autoJoinPublicChannels(slack: WebClient, channels: any[]) {
  console.log('Auto-joining public channels...');
  let joined = 0;
  let alreadyMember = 0;
  let failed = 0;

  for (const channel of channels) {
    // Skip private channels and archived channels
    if (channel.is_private || channel.is_archived) {
      continue;
    }
    if (channel.raw_payload?.is_member) {
      alreadyMember++;
      continue;
    }

    try {
      // Slack answers a join to a channel we're already in with ok plus an
      // already_in_channel warning, not an error.
      const result: any = await slack.conversations.join({ channel: channel.channel_id });
      if (result.already_in_channel || result.warning === 'already_in_channel') {
        alreadyMember++;
        continue;
      }
      joined++;
      console.log(`  ✓ Joined #${channel.name}`);

      // Small delay to avoid rate limits
      await sleep(100);
    } catch (error: any) {
      if (error.data?.error === 'already_in_channel') {
        alreadyMember++;
        // Silently count - we're already in the channel
      } else {
        console.warn(`  ⚠ Could not join #${channel.name}: ${error.data?.error || error.message}`);
        failed++;
      }
    }
  }

  if (joined > 0) {
    console.log(`  Joined ${joined} new channels`);
  }
  if (alreadyMember > 0) {
    console.log(`  Already member of ${alreadyMember} channels`);
  }
  if (failed > 0) {
    console.log(`  Failed to join ${failed} channels`);
  }
}

async function fetchChannelHistory(
  slack: WebClient,
  channelId: string,
  channelName: string,
  channelType: string,
  oldest: number,
  latest: number
) {
  const messages: any[] = [];
  const reactions: any[] = [];
  let cursor: string | undefined;

  do {
    const result: any = await slack.conversations.history({
      channel: channelId,
      oldest: oldest.toString(),
      latest: latest.toString(),
      cursor,
      limit: 200
    });

    for (const msg of result.messages ?? []) {
      addMessage(msg, channelId, channelName, channelType, messages, reactions);
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return { messages, reactions };
}

const THREAD_CONCURRENCY = 5;

/**
 * Replies already stored for these threads, keyed by threadKey. Compared with
 * what Slack reports to decide which threads need fetching.
 */
async function loadStoredThreadReplies(supabase: SupabaseClient, parents: any[]) {
  const stored = new Map<string, StoredThreadReplies>();
  const tsByChannel = new Map<string, string[]>();
  for (const p of parents) {
    const list = tsByChannel.get(p.channel_id) ?? [];
    list.push(p.message_ts);
    tsByChannel.set(p.channel_id, list);
  }

  const CHUNK = 100;
  const PAGE = 1000;
  for (const [channelId, threadTs] of tsByChannel) {
    for (let i = 0; i < threadTs.length; i += CHUNK) {
      const chunk = threadTs.slice(i, i + CHUNK);
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await supabase
          .schema('bronze')
          .from('slack_messages')
          .select('thread_ts, message_ts')
          .eq('channel_id', channelId)
          .in('thread_ts', chunk)
          .order('message_ts')
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          if (row.message_ts === row.thread_ts) continue; // the parent itself
          const key = threadKey(channelId, row.thread_ts);
          const have = stored.get(key) ?? { count: 0, latestTs: null };
          have.count++;
          if (!have.latestTs || parseFloat(row.message_ts) > parseFloat(have.latestTs)) have.latestTs = row.message_ts;
          stored.set(key, have);
        }
        if (!data || data.length < PAGE) break;
      }
    }
  }
  return stored;
}

/**
 * Fetch every reply in the given threads, 5 at a time. When Slack
 * rate-limits, WebClient waits out the 429's Retry-After and retries. Stops
 * starting new threads at `deadline`; the rest are counted as deferred.
 */
async function fetchThreadReplies(slack: WebClient, parents: any[], deadline: number) {
  const messages: any[] = [];
  const reactions: any[] = [];
  const queue = [...parents];

  const worker = async () => {
    for (let parent = queue.shift(); parent; parent = queue.shift()) {
      if (Date.now() >= deadline) {
        queue.unshift(parent);
        return;
      }
      // Buffer per thread so a thread is stored whole or not at all.
      const threadMessages: any[] = [];
      const threadReactions: any[] = [];
      let cursor: string | undefined;
      do {
        const result: any = await slack.conversations.replies({
          channel: parent.channel_id,
          ts: parent.message_ts,
          cursor,
          limit: 200
        });
        for (const msg of result.messages ?? []) {
          if (msg.ts === parent.message_ts) continue; // the parent is already in history
          addMessage(msg, parent.channel_id, parent.channel_name, parent.channel_type, threadMessages, threadReactions);
        }
        cursor = result.response_metadata?.next_cursor;
      } while (cursor);
      messages.push(...threadMessages);
      reactions.push(...threadReactions);
    }
  };

  await Promise.all(Array.from({ length: THREAD_CONCURRENCY }, worker));
  return { messages, reactions, deferred: queue.length };
}

function addMessage(
  msg: any,
  channelId: string,
  channelName: string,
  channelType: string,
  messages: any[],
  reactions: any[]
) {
  // Skip join/leave messages (keep file_share, thread_broadcast)
  if (!isKeptSlackMessage(msg)) {
    return;
  }

  messages.push({
    message_ts: msg.ts,
    channel_id: channelId,
    channel_name: channelName,
    channel_type: channelType,
    user_id: slackMessageUserId(msg),
    user_email: '', // Will be filled from users map later
    user_name: '', // Will be filled from users map later
    text: msg.text || '',
    message_type: msg.subtype || 'message',
    thread_ts: msg.thread_ts || null,
    reply_count: msg.reply_count || 0,
    reply_users_count: msg.reply_users_count || 0,
    occurred_at: slackTsToIso(msg.ts),
    edited_at: msg.edited ? new Date(msg.edited.ts * 1000).toISOString() : null,
    deleted_at: null,
    files: msg.files ? msg.files : null,
    raw_payload: msg
  });

  // Extract reactions
  if (msg.reactions) {
    for (const reaction of msg.reactions) {
      for (const userId of reaction.users) {
        reactions.push({
          message_ts: msg.ts,
          channel_id: channelId,
          channel_name: channelName,
          reaction: reaction.name,
          user_id: userId,
          user_email: '', // Will be filled later
          user_name: '', // Will be filled later
          occurred_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
          removed_at: null,
          raw_payload: reaction
        });
      }
    }
  }
}

const UPSERT_BATCH_SIZE = 500;
const UPSERT_CONCURRENCY = 4;

async function upsertInBatches(supabase: SupabaseClient, table: string, rows: any[], onConflict: string) {
  const batches: any[][] = [];
  for (let i = 0; i < rows.length; i += UPSERT_BATCH_SIZE) batches.push(rows.slice(i, i + UPSERT_BATCH_SIZE));

  for (let i = 0; i < batches.length; i += UPSERT_CONCURRENCY) {
    const results = await Promise.all(
      batches.slice(i, i + UPSERT_CONCURRENCY).map(batch =>
        supabase.schema('bronze').from(table).upsert(batch, { onConflict })
      )
    );
    const failed = results.find(r => r.error);
    if (failed?.error) throw failed.error;
  }
}

function dedupeBy<T>(rows: T[], key: (row: T) => string) {
  const seen = new Set<string>();
  let kept = 0;
  for (const row of rows) {
    const k = key(row);
    if (seen.has(k)) continue;
    seen.add(k);
    rows[kept++] = row;
  }
  rows.length = kept;
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
