import { WebClient } from '@slack/web-api';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 300; // 5 minutes for Slack API calls

interface SlackApiImportRequest {
  daysBack: number;
}

export async function POST(request: NextRequest) {
  // Check authentication
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests/scripts
    const { createClient: createSupabaseClient } = await import('@supabase/supabase-js');
    supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );
  } else {
    // Use cookie-based client for normal requests
    supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

    if (!SLACK_BOT_TOKEN) {
      return NextResponse.json(
        { error: "SLACK_BOT_TOKEN environment variable not configured" },
        { status: 500 }
      );
    }

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

    console.log(`  Fetched ${allMessages.length} messages, ${allReactions.length} reactions`);

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

    const { error: usersError } = await supabase
      .schema('bronze').from("slack_users")
      .upsert(
        users.map(u => ({ ...u, imported_at: importTimestamp })),
        { onConflict: "user_id" }
      );

    const { error: channelsError } = await supabase
      .schema('bronze').from("slack_channels")
      .upsert(
        channels.map(c => ({ ...c, imported_at: importTimestamp })),
        { onConflict: "channel_id" }
      );

    const { error: messagesError } = await supabase
      .schema('bronze').from("slack_messages")
      .upsert(
        allMessages.map(m => ({ ...m, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts" }
      );

    const { error: reactionsError } = await supabase
      .schema('bronze').from("slack_reactions")
      .upsert(
        allReactions.map(r => ({ ...r, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts,reaction,user_id" }
      );

    if (usersError) throw usersError;
    if (channelsError) throw channelsError;
    if (messagesError) throw messagesError;
    if (reactionsError) throw reactionsError;

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
    let processingResults = null;
    if (dateRange) {
      console.log(`Triggering Slack processing for date range: ${dateRange.fromDate} to ${dateRange.toDate}`);
      processingResults = await triggerReprocessing('slack_messages', 'bronze', {
        dateRange: {
          from: new Date(dateRange.fromDate),
          to: new Date(dateRange.toDate + 'T23:59:59Z')
        }
      });
    }

    return NextResponse.json({
      success: true,
      fetched: {
        users: users.length,
        channels: channels.length,
        messages: allMessages.length,
        reactions: allReactions.length,
      },
      daysBack,
      imported: {
        users: users.length,
        channels: channels.length,
        messages: allMessages.length,
        reactions: allReactions.length,
      },
      importTimestamp,
      dateRange,
      processing: processingResults?.processed || [],
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

    try {
      await slack.conversations.join({ channel: channel.channel_id });
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

    if (result.messages) {
      for (const msg of result.messages) {
        // Skip join/leave messages (keep file_share, thread_broadcast)
        if (msg.subtype && !['file_share', 'thread_broadcast'].includes(msg.subtype)) {
          continue;
        }

        messages.push({
          message_ts: msg.ts,
          channel_id: channelId,
          channel_name: channelName,
          channel_type: channelType,
          user_id: msg.user || msg.bot_id || 'unknown',
          user_email: '', // Will be filled from users map later
          user_name: '', // Will be filled from users map later
          text: msg.text || '',
          message_type: msg.subtype || 'message',
          thread_ts: msg.thread_ts || null,
          reply_count: msg.reply_count || 0,
          reply_users_count: msg.reply_users_count || 0,
          occurred_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
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
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  return { messages, reactions };
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
