#!/usr/bin/env ts-node

import { WebClient } from '@slack/web-api';
import { writeFileSync, mkdirSync } from 'fs';
import { parse } from 'json2csv';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

if (!SLACK_BOT_TOKEN) {
  console.error('Error: SLACK_BOT_TOKEN environment variable is required');
  process.exit(1);
}

const slack = new WebClient(SLACK_BOT_TOKEN);

interface ExportOptions {
  daysBack: number;
  outputDir: string;
}

async function main() {
  const daysBack = parseInt(process.argv[2] || '30', 10);
  const outputDir = process.argv[3] || 'exports';

  console.log(`Exporting ${daysBack} days of Slack data to ${outputDir}/`);

  await exportSlackData({ daysBack, outputDir });

  console.log('Export complete!');
}

async function exportSlackData(options: ExportOptions) {
  const { daysBack, outputDir } = options;

  // Create output directory
  try {
    mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    // Directory already exists
  }

  const oldest = Math.floor(Date.now() / 1000) - (daysBack * 24 * 60 * 60);
  const latest = Math.floor(Date.now() / 1000);

  console.log(`Date range: ${new Date(oldest * 1000).toISOString()} to ${new Date(latest * 1000).toISOString()}`);

  // 1. Export users
  const users = await fetchAllUsers();
  writeCSV(outputDir, 'slack_users.csv', users);

  // 2. Export channels
  const channels = await fetchAllChannels();
  writeCSV(outputDir, 'slack_channels.csv', channels);

  // 2.5. Auto-join public channels
  await autoJoinPublicChannels(channels);

  // 3. Export messages and reactions
  console.log('Fetching messages...');
  const allMessages: any[] = [];
  const allReactions: any[] = [];

  for (const channel of channels) {
    console.log(`  Processing #${channel.name}...`);
    const { messages, reactions } = await fetchChannelHistory(
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

  writeCSV(outputDir, 'slack_messages.csv', allMessages);
  writeCSV(outputDir, 'slack_reactions.csv', allReactions);
}

async function fetchAllUsers() {
  console.log('Fetching users...');
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
        raw_payload: JSON.stringify(u)
      })));
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`  Fetched ${users.length} users`);
  return users;
}

async function fetchAllChannels() {
  console.log('Fetching channels...');
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
        raw_payload: JSON.stringify(c)
      })));
    }

    cursor = result.response_metadata?.next_cursor;
  } while (cursor);

  console.log(`  Fetched ${channels.length} channels`);
  return channels;
}

async function autoJoinPublicChannels(channels: any[]) {
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
      } else {
        console.warn(`  ⚠ Could not join #${channel.name}: ${error.data?.error || error.message}`);
        failed++;
      }
    }
  }

  console.log(`  Joined ${joined} new channels, already member of ${alreadyMember}, ${failed} failed`);
}

async function fetchChannelHistory(
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
          files: msg.files ? JSON.stringify(msg.files) : null,
          raw_payload: JSON.stringify(msg)
        });

        // Extract reactions
        if (msg.reactions) {
          for (const reaction of msg.reactions) {
            for (const userId of reaction.users) {
              reactions.push({
                message_ts: msg.ts,
                channel_id: channelId,
                reaction: reaction.name,
                user_id: userId,
                user_email: '', // Will be filled later
                user_name: '', // Will be filled later
                occurred_at: new Date(parseFloat(msg.ts) * 1000).toISOString(),
                removed_at: null,
                raw_payload: JSON.stringify(reaction)
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

function writeCSV(outputDir: string, filename: string, data: any[]) {
  if (data.length === 0) {
    console.warn(`  ⚠ No data for ${filename}, skipping`);
    return;
  }

  const csv = parse(data);
  const filepath = `${outputDir}/${filename}`;
  writeFileSync(filepath, csv);
  console.log(`  ✓ ${filename} (${data.length} rows)`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
