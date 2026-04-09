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
