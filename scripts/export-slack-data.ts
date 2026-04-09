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

  // TODO: Implement export logic
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
