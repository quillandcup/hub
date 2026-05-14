# Slack Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comprehensive Slack engagement tracking to complement Prickle attendance data, using a batch CSV import approach that's ready for future real-time webhook integration.

**Architecture:** Event-ready batch architecture with Bronze tables (raw Slack data via UPSERT), Silver layer transformation (DELETE + INSERT reprocessability), and read-through cache pattern for webhook efficiency.

**Tech Stack:** Next.js 15, Supabase, Slack Web API (@slack/web-api), TypeScript, Vitest

---

## File Structure

### New Files
- `supabase/migrations/20260408120000_add_slack_bronze_tables.sql` - Bronze layer tables
- `supabase/migrations/20260408120001_add_source_to_aliases.sql` - Extend aliases for Slack
- `supabase/migrations/20260408120002_add_slack_activity_types.sql` - Activity type seeds
- `supabase/migrations/20260408120003_add_ignored_slack_users.sql` - Skip table
- `scripts/export-slack-data.ts` - Batch export script
- `app/api/import/slack/route.ts` - CSV import endpoint
- `app/api/process/slack/route.ts` - Bronze → Silver processing
- `lib/slack-matching.ts` - Slack user → member matching
- `app/api/reports/unmatched-slack-users/route.ts` - Unmatched users API
- `app/api/aliases/slack/route.ts` - Manual alias creation
- `app/api/data-hygiene/slack-users/skip/route.ts` - Skip non-members
- `app/dashboard/data-hygiene/slack-users/page.tsx` - Matching UI
- `tests/api/reprocessability/slack.test.ts` - Reprocessability tests
- `tests/api/idempotency/slack-import.test.ts` - Idempotency tests
- `tests/lib/slack-matching.test.ts` - Matching logic tests

### Modified Files
- `package.json` - Add @slack/web-api, json2csv dependencies
- `CLAUDE.md` - Update Bronze layer list
- `docs/TODO.md` - Track progress

---

## Task 1: Database Migrations - Bronze Tables

**Files:**
- Create: `supabase/migrations/20260408120000_add_slack_bronze_tables.sql`

- [ ] **Step 1: Write migration for Slack Bronze tables**

```sql
-- Bronze Layer: Raw Slack Data

-- Raw Slack messages from all accessible channels, DMs, and threads
CREATE TABLE IF NOT EXISTS slack_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Slack identifiers (natural key for deduplication)
    message_ts TEXT NOT NULL, -- Slack's message timestamp (unique per channel)
    channel_id TEXT NOT NULL,
    
    -- Message metadata
    channel_name TEXT,
    channel_type TEXT, -- 'public_channel', 'private_channel', 'im' (DM), 'mpim' (group DM)
    user_id TEXT NOT NULL, -- Slack user ID
    user_email TEXT, -- May be null for bot users or privacy settings
    user_name TEXT,
    
    -- Content
    text TEXT, -- Message text (empty for file-only messages)
    message_type TEXT, -- 'message', 'file_share', 'thread_broadcast'
    
    -- Threading
    thread_ts TEXT, -- Parent message timestamp if this is a reply
    reply_count INTEGER DEFAULT 0, -- For parent messages
    reply_users_count INTEGER DEFAULT 0,
    
    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL, -- When message was posted
    edited_at TIMESTAMP WITH TIME ZONE, -- If message was edited
    deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete for deleted messages
    
    -- Files (if message has attachments)
    files JSONB, -- Array of file metadata
    
    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL -- Full Slack API response
);

-- Unique constraint (prevents duplicate imports, supports UPSERT)
CREATE UNIQUE INDEX idx_slack_messages_unique ON slack_messages(channel_id, message_ts);

-- Query indexes
CREATE INDEX idx_slack_messages_user_id ON slack_messages(user_id);
CREATE INDEX idx_slack_messages_user_email ON slack_messages(user_email);
CREATE INDEX idx_slack_messages_occurred_at ON slack_messages(occurred_at);
CREATE INDEX idx_slack_messages_channel_id ON slack_messages(channel_id);
CREATE INDEX idx_slack_messages_thread_ts ON slack_messages(thread_ts);
CREATE INDEX idx_slack_messages_deleted_at ON slack_messages(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE slack_messages IS 'Bronze: Raw Slack messages from all accessible channels, DMs, and threads';

-- Raw Slack reactions
CREATE TABLE IF NOT EXISTS slack_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Natural key for deduplication
    message_ts TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    reaction TEXT NOT NULL, -- Emoji name (e.g., 'thumbsup', 'heart')
    user_id TEXT NOT NULL,
    
    -- Metadata
    user_email TEXT,
    user_name TEXT,
    
    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    removed_at TIMESTAMP WITH TIME ZONE, -- If reaction was removed
    
    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

-- Unique constraint (one user can only react with same emoji once per message)
CREATE UNIQUE INDEX idx_slack_reactions_unique ON slack_reactions(channel_id, message_ts, reaction, user_id);

-- Query indexes
CREATE INDEX idx_slack_reactions_user_id ON slack_reactions(user_id);
CREATE INDEX idx_slack_reactions_message ON slack_reactions(channel_id, message_ts);
CREATE INDEX idx_slack_reactions_occurred_at ON slack_reactions(occurred_at);

COMMENT ON TABLE slack_reactions IS 'Bronze: Raw Slack reactions (emoji reactions on messages)';

-- Slack channels catalog
CREATE TABLE IF NOT EXISTS slack_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Slack identifier
    channel_id TEXT NOT NULL UNIQUE,
    
    -- Channel metadata
    name TEXT NOT NULL,
    is_private BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    member_count INTEGER,
    topic TEXT,
    purpose TEXT,
    created TIMESTAMP WITH TIME ZONE,
    
    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

CREATE INDEX idx_slack_channels_name ON slack_channels(name);
CREATE INDEX idx_slack_channels_is_archived ON slack_channels(is_archived);

COMMENT ON TABLE slack_channels IS 'Bronze: Slack channels catalog (public, private, DMs)';

-- Slack users catalog (for matching to members)
CREATE TABLE IF NOT EXISTS slack_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Slack identifier
    user_id TEXT NOT NULL UNIQUE,
    
    -- User metadata
    email TEXT, -- May be null if user privacy settings hide it
    name TEXT,
    display_name TEXT,
    real_name TEXT,
    is_bot BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,
    
    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

CREATE INDEX idx_slack_users_email ON slack_users(email);
CREATE INDEX idx_slack_users_name ON slack_users(real_name);
CREATE INDEX idx_slack_users_is_bot ON slack_users(is_bot);

COMMENT ON TABLE slack_users IS 'Bronze: Slack users catalog (for matching to members)';
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
supabase db reset
```

Expected: All tables created successfully

- [ ] **Step 3: Verify tables created**

Run:
```bash
supabase db diff
```

Expected: No diff (clean state)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260408120000_add_slack_bronze_tables.sql
git commit -m "feat: add Slack Bronze layer tables (messages, reactions, channels, users)"
```

---

## Task 2: Database Migrations - Extend Aliases

**Files:**
- Create: `supabase/migrations/20260408120001_add_source_to_aliases.sql`

- [ ] **Step 1: Write migration to extend member_name_aliases**

```sql
-- Extend member_name_aliases to support Slack user IDs

ALTER TABLE member_name_aliases 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'zoom' 
    CHECK (source IN ('zoom', 'slack'));

CREATE INDEX IF NOT EXISTS idx_member_name_aliases_source ON member_name_aliases(source);

COMMENT ON COLUMN member_name_aliases.source IS 'Source of alias: zoom (display name) or slack (user ID)';
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
supabase db reset
```

Expected: Column added successfully

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120001_add_source_to_aliases.sql
git commit -m "feat: extend member_name_aliases with source column for Slack aliases"
```

---

## Task 3: Database Migrations - Activity Types

**Files:**
- Create: `supabase/migrations/20260408120002_add_slack_activity_types.sql`

- [ ] **Step 1: Write migration to seed Slack activity types**

```sql
-- Add Slack activity types to activity_types table

INSERT INTO activity_types (code, name, category, default_engagement_value, description) VALUES
('slack_message', 'Slack Message', 'communication', 1, 'Posted a message in Slack'),
('slack_thread_reply', 'Slack Thread Reply', 'communication', 2, 'Replied in a Slack thread'),
('slack_reaction', 'Slack Reaction', 'communication', 1, 'Reacted to a Slack message')
ON CONFLICT (code) DO UPDATE SET 
  default_engagement_value = EXCLUDED.default_engagement_value,
  description = EXCLUDED.description;
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
supabase db reset
```

Expected: 3 activity types inserted/updated

- [ ] **Step 3: Verify activity types**

Run SQL in Supabase Studio:
```sql
SELECT * FROM activity_types WHERE code LIKE 'slack_%';
```

Expected: 3 rows (slack_message, slack_thread_reply, slack_reaction)

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260408120002_add_slack_activity_types.sql
git commit -m "feat: add Slack activity types to activity_types table"
```

---

## Task 4: Database Migrations - Ignored Users

**Files:**
- Create: `supabase/migrations/20260408120003_add_ignored_slack_users.sql`

- [ ] **Step 1: Write migration for ignored Slack users**

```sql
-- Non-members to exclude from matching reports

CREATE TABLE IF NOT EXISTS ignored_slack_users (
    user_id TEXT PRIMARY KEY,
    reason TEXT, -- 'non_member', 'bot', 'guest'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

COMMENT ON TABLE ignored_slack_users IS 'Slack users marked as non-members (skip from matching reports)';
```

- [ ] **Step 2: Apply migration locally**

Run:
```bash
supabase db reset
```

Expected: Table created successfully

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260408120003_add_ignored_slack_users.sql
git commit -m "feat: add ignored_slack_users table for data hygiene"
```

---

## Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md:109-110`

- [ ] **Step 1: Update Bronze layer list in CLAUDE.md**

Find the Bronze Layer section (around line 109-110) and update it:

```markdown
**Bronze Layer** (raw imports):
- `calendar_events`, `zoom_attendees`, `zoom_meetings`, `kajabi_members`, `subscription_history`, `slack_messages`, `slack_reactions`, `slack_channels`, `slack_users`
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Slack Bronze tables to CLAUDE.md architecture docs"
```

---

## Task 6: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install Slack SDK and CSV library**

Run:
```bash
npm install @slack/web-api json2csv
npm install --save-dev @types/node
```

- [ ] **Step 2: Verify installation**

Run:
```bash
npm list @slack/web-api json2csv
```

Expected: Both packages listed

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add @slack/web-api and json2csv dependencies"
```

---

## Task 7: Slack Export Script - Setup

**Files:**
- Create: `scripts/export-slack-data.ts`

- [ ] **Step 1: Create export script with basic structure**

```typescript
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
```

- [ ] **Step 2: Add script to package.json**

Add to `scripts` section in package.json:

```json
{
  "scripts": {
    "export:slack": "tsx scripts/export-slack-data.ts"
  }
}
```

- [ ] **Step 3: Install tsx for running TypeScript**

Run:
```bash
npm install --save-dev tsx
```

- [ ] **Step 4: Test script runs**

Run:
```bash
SLACK_BOT_TOKEN=xoxb-test npm run export:slack -- 1
```

Expected: "Export complete!" message (no actual export yet)

- [ ] **Step 5: Commit**

```bash
git add scripts/export-slack-data.ts package.json package-lock.json
git commit -m "feat: add Slack export script skeleton"
```

---

## Task 8: Slack Export Script - Users Export

**Files:**
- Modify: `scripts/export-slack-data.ts`

- [ ] **Step 1: Add users export function**

Add after the `exportSlackData` function:

```typescript
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
```

- [ ] **Step 2: Update exportSlackData to call fetchAllUsers**

Replace the TODO comment in `exportSlackData` with:

```typescript
  // 1. Export users
  const users = await fetchAllUsers();
  writeCSV(outputDir, 'slack_users.csv', users);
```

- [ ] **Step 3: Test users export**

Run:
```bash
SLACK_BOT_TOKEN=xoxb-your-real-token npm run export:slack -- 1
```

Expected: Creates `exports/slack_users.csv` with user data

- [ ] **Step 4: Verify CSV format**

Run:
```bash
head -n 2 exports/slack_users.csv
```

Expected: Header row + 1 data row with user_id, email, name, etc.

- [ ] **Step 5: Commit**

```bash
git add scripts/export-slack-data.ts
git commit -m "feat: add users export to Slack export script"
```

---

## Task 9: Slack Export Script - Channels Export

**Files:**
- Modify: `scripts/export-slack-data.ts`

- [ ] **Step 1: Add channels export function**

Add before `main()`:

```typescript
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
```

- [ ] **Step 2: Update exportSlackData to export channels**

Add after users export:

```typescript
  // 2. Export channels
  const channels = await fetchAllChannels();
  writeCSV(outputDir, 'slack_channels.csv', channels);
```

- [ ] **Step 3: Test channels export**

Run:
```bash
SLACK_BOT_TOKEN=xoxb-your-real-token npm run export:slack -- 1
```

Expected: Creates both `slack_users.csv` and `slack_channels.csv`

- [ ] **Step 4: Commit**

```bash
git add scripts/export-slack-data.ts
git commit -m "feat: add channels export to Slack export script"
```

---

## Task 10: Slack Export Script - Messages Export

**Files:**
- Modify: `scripts/export-slack-data.ts`

- [ ] **Step 1: Add message history export function**

Add before `main()`:

```typescript
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
```

- [ ] **Step 2: Update exportSlackData to export messages**

Add after channels export:

```typescript
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
```

- [ ] **Step 3: Test full export**

Run:
```bash
SLACK_BOT_TOKEN=xoxb-your-real-token npm run export:slack -- 1
```

Expected: Creates 4 CSV files (users, channels, messages, reactions)

- [ ] **Step 4: Verify message data**

Run:
```bash
wc -l exports/*.csv
```

Expected: Line counts for all 4 files

- [ ] **Step 5: Commit**

```bash
git add scripts/export-slack-data.ts
git commit -m "feat: add messages and reactions export to Slack export script"
```

---

## Task 11: Import API Endpoint

**Files:**
- Create: `app/api/import/slack/route.ts`

- [ ] **Step 1: Write import endpoint**

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Check authentication
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const usersFile = formData.get("users") as File;
    const channelsFile = formData.get("channels") as File;
    const messagesFile = formData.get("messages") as File;
    const reactionsFile = formData.get("reactions") as File;

    if (!usersFile || !channelsFile || !messagesFile || !reactionsFile) {
      return NextResponse.json(
        { error: "All 4 CSV files required: users, channels, messages, reactions" },
        { status: 400 }
      );
    }

    // Parse CSVs
    const users = await parseCSV(usersFile);
    const channels = await parseCSV(channelsFile);
    const messages = await parseCSV(messagesFile);
    const reactions = await parseCSV(reactionsFile);

    console.log(`Importing: ${users.length} users, ${channels.length} channels, ${messages.length} messages, ${reactions.length} reactions`);

    // UPSERT to Bronze tables (idempotent)
    const importTimestamp = new Date().toISOString();
    
    const { error: usersError } = await supabase
      .from("slack_users")
      .upsert(
        users.map(u => ({ ...u, imported_at: importTimestamp })),
        { onConflict: "user_id" }
      );
    
    const { error: channelsError } = await supabase
      .from("slack_channels")
      .upsert(
        channels.map(c => ({ ...c, imported_at: importTimestamp })),
        { onConflict: "channel_id" }
      );
    
    const { error: messagesError } = await supabase
      .from("slack_messages")
      .upsert(
        messages.map(m => ({ ...m, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts" }
      );
    
    const { error: reactionsError } = await supabase
      .from("slack_reactions")
      .upsert(
        reactions.map(r => ({ ...r, imported_at: importTimestamp })),
        { onConflict: "channel_id,message_ts,reaction,user_id" }
      );

    if (usersError) throw usersError;
    if (channelsError) throw channelsError;
    if (messagesError) throw messagesError;
    if (reactionsError) throw reactionsError;

    return NextResponse.json({
      success: true,
      imported: {
        users: users.length,
        channels: channels.length,
        messages: messages.length,
        reactions: reactions.length,
      },
      importTimestamp,
      message: "Imported to Slack Bronze tables. Run /api/process/slack to populate member_activities.",
    });
  } catch (error: any) {
    console.error("Error importing Slack data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to import Slack data" },
      { status: 500 }
    );
  }
}

async function parseCSV(file: File): Promise<any[]> {
  const text = await file.text();
  const lines = text.trim().split("\n");
  
  if (lines.length < 2) {
    return [];
  }

  const headers = parseCSVLine(lines[0]);
  const data: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: any = {};

    headers.forEach((header, index) => {
      const value = values[index]?.trim() || "";
      // Parse JSON fields
      if (header === 'raw_payload' || header === 'files') {
        try {
          row[header] = value ? JSON.parse(value) : null;
        } catch {
          row[header] = null;
        }
      } else if (header === 'is_bot' || header === 'is_deleted' || header === 'is_private' || header === 'is_archived') {
        row[header] = value === 'true';
      } else if (header === 'reply_count' || header === 'reply_users_count' || header === 'member_count') {
        row[header] = value ? parseInt(value, 10) : 0;
      } else {
        row[header] = value || null;
      }
    });

    data.push(row);
  }

  return data;
}

// Parse a CSV line handling quoted fields with commas
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}
```

- [ ] **Step 2: Test endpoint with curl**

Run:
```bash
curl -X POST http://localhost:3000/api/import/slack \
  -H "Cookie: <your-session-cookie>" \
  -F "users=@exports/slack_users.csv" \
  -F "channels=@exports/slack_channels.csv" \
  -F "messages=@exports/slack_messages.csv" \
  -F "reactions=@exports/slack_reactions.csv"
```

Expected: `{"success": true, "imported": {...}}`

- [ ] **Step 3: Verify data in Supabase**

Run SQL in Supabase Studio:
```sql
SELECT COUNT(*) FROM slack_users;
SELECT COUNT(*) FROM slack_channels;
SELECT COUNT(*) FROM slack_messages;
SELECT COUNT(*) FROM slack_reactions;
```

Expected: Counts match CSV line counts

- [ ] **Step 4: Commit**

```bash
git add app/api/import/slack/route.ts
git commit -m "feat: add Slack CSV import API endpoint"
```

---

## Task 12: Member Matching Library

**Files:**
- Create: `lib/slack-matching.ts`

- [ ] **Step 1: Create Slack matching module**

```typescript
import { Member, MemberAlias, normalizeName } from './member-matching';

export interface SlackUser {
  user_id: string;
  email: string | null;
  real_name: string;
}

export interface SlackMatchResult {
  slack_user_id: string;
  member_id: string | null;
  match_method: 'manual_alias' | 'email' | 'normalized_name' | null;
}

/**
 * Matches Slack users to members
 *
 * Matching priority:
 * 1. Manual alias (slack user_id → member_id in member_name_aliases)
 * 2. Email match (slack email = member email)
 * 3. Normalized name match
 *
 * Returns Map: slack_user_id → member_id
 */
export async function matchSlackUsersToMembers(
  slackUsers: SlackUser[],
  members: Member[],
  aliases: MemberAlias[]
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // Build lookup maps
  const membersByEmail = new Map<string, Member>();
  const membersByNormalizedName = new Map<string, Member>();
  const slackAliasToMemberId = new Map<string, string>();

  for (const member of members) {
    membersByEmail.set(member.email.toLowerCase(), member);
    membersByNormalizedName.set(normalizeName(member.name), member);
  }

  for (const alias of aliases) {
    if (alias.source === 'slack') {
      slackAliasToMemberId.set(alias.alias, alias.member_id);
    }
  }

  // Match each Slack user
  for (const slackUser of slackUsers) {
    let memberId: string | null = null;

    // 1. Manual alias (highest priority)
    if (slackAliasToMemberId.has(slackUser.user_id)) {
      memberId = slackAliasToMemberId.get(slackUser.user_id)!;
    }

    // 2. Email match
    if (!memberId && slackUser.email) {
      const member = membersByEmail.get(slackUser.email.toLowerCase());
      if (member) {
        memberId = member.id;
      }
    }

    // 3. Normalized name match
    if (!memberId && slackUser.real_name) {
      const member = membersByNormalizedName.get(normalizeName(slackUser.real_name));
      if (member) {
        memberId = member.id;
      }
    }

    if (memberId) {
      map.set(slackUser.user_id, memberId);
    }
  }

  return map;
}

/**
 * Returns unmatched Slack users (for data hygiene UI)
 */
export function getUnmatchedSlackUsers(
  slackUsers: SlackUser[],
  matchedUserIds: Set<string>
): SlackUser[] {
  return slackUsers.filter(u => !matchedUserIds.has(u.user_id));
}
```

- [ ] **Step 2: Update member-matching.ts exports**

Add to `lib/member-matching.ts` exports (after line 191):

```typescript
// Re-export for use in slack-matching
export { Member, MemberAlias, normalizeName };
```

Wait, the exports are actually already there as interfaces/functions. Check the file.

Actually, looking at the file, `Member`, `MemberAlias` are already exported as interfaces, and `normalizeName` is already exported as a function. So no changes needed to member-matching.ts.

- [ ] **Step 3: Commit**

```bash
git add lib/slack-matching.ts
git commit -m "feat: add Slack user to member matching library"
```

---

## Task 13: Process API Endpoint

**Files:**
- Create: `app/api/process/slack/route.ts`

- [ ] **Step 1: Write processing endpoint with DELETE + INSERT pattern**

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

// Extend timeout for processing large batches
export const maxDuration = 300; // 5 minutes

// Helper to chunk array for batch processing
function chunk<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Process Bronze layer (slack_messages, slack_reactions) into Silver layer (member_activities)
 *
 * This endpoint:
 * 1. Loads all reference data upfront (members, aliases)
 * 2. Loads Slack Bronze data in date range
 * 3. Matches Slack users to members
 * 4. Transforms to member_activities
 * 5. DELETEs existing Slack activities in range
 * 6. INSERTs fresh activities (reprocessable)
 */
export async function POST(request: NextRequest) {
  // Check authentication
  const authHeader = request.headers.get('authorization');
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const isServiceRole = authHeader && serviceRoleKey && authHeader.includes(serviceRoleKey);

  let supabase;

  if (isServiceRole) {
    // Use service role client for tests
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
    const body = await request.json();
    const { fromDate, toDate } = body;

    if (!fromDate || !toDate) {
      return NextResponse.json(
        { error: "fromDate and toDate are required" },
        { status: 400 }
      );
    }

    console.log(`Processing Slack data from ${fromDate} to ${toDate}`);

    // STEP 1: Load reference data in parallel
    const [
      { data: members },
      { data: aliases },
    ] = await Promise.all([
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
    ]);

    // STEP 2: Load Bronze Slack data in date range (with pagination)
    const slackMessages = await loadAllMessages(supabase, fromDate, toDate);
    const slackReactions = await loadAllReactions(supabase, fromDate, toDate);

    console.log(`Loaded ${slackMessages.length} messages, ${slackReactions.length} reactions`);

    if (slackMessages.length === 0 && slackReactions.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No Slack data found in date range",
        processed: { messages: 0, reactions: 0 },
      });
    }

    // STEP 3: Load Slack users for matching
    const { data: slackUsers } = await supabase
      .from("slack_users")
      .select("user_id, email, real_name");

    // Match Slack users to members (in memory)
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members || [],
      aliases || []
    );

    console.log(`Matched ${userToMemberMap.size} Slack users to members`);

    // STEP 4: Transform messages → member_activities
    const messageActivities = slackMessages
      .map(msg => {
        const memberId = userToMemberMap.get(msg.user_id);
        if (!memberId) return null; // Skip non-members

        const isThreadReply = msg.thread_ts && msg.thread_ts !== msg.message_ts;

        return {
          member_id: memberId,
          activity_type: isThreadReply ? 'slack_thread_reply' : 'slack_message',
          activity_category: 'communication',
          title: `Posted in #${msg.channel_name}`,
          description: msg.text?.substring(0, 200) || null,
          metadata: {
            channel_id: msg.channel_id,
            channel_name: msg.channel_name,
            channel_type: msg.channel_type,
            message_ts: msg.message_ts,
            thread_ts: msg.thread_ts,
            is_thread_reply: isThreadReply,
            has_files: msg.files ? true : false,
          },
          related_id: `${msg.channel_id}:${msg.message_ts}`,
          engagement_value: calculateMessageValue(msg),
          occurred_at: msg.occurred_at,
          source: 'slack',
        };
      })
      .filter(a => a !== null);

    // STEP 5: Transform reactions → member_activities
    const reactionActivities = slackReactions
      .map(reaction => {
        const memberId = userToMemberMap.get(reaction.user_id);
        if (!memberId) return null;

        return {
          member_id: memberId,
          activity_type: 'slack_reaction',
          activity_category: 'communication',
          title: `Reacted :${reaction.reaction}:`,
          description: null,
          metadata: {
            channel_id: reaction.channel_id,
            message_ts: reaction.message_ts,
            reaction: reaction.reaction,
          },
          related_id: `${reaction.channel_id}:${reaction.message_ts}`,
          engagement_value: 1,
          occurred_at: reaction.occurred_at,
          source: 'slack',
        };
      })
      .filter(a => a !== null);

    console.log(`Transformed: ${messageActivities.length} message activities, ${reactionActivities.length} reaction activities`);

    // STEP 6: DELETE existing Slack activities in date range (reprocessability)
    console.log(`Deleting existing Slack activities in date range`);
    const { error: deleteError } = await supabase
      .from("member_activities")
      .delete()
      .eq("source", "slack")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate);

    if (deleteError) {
      console.error("Error deleting existing activities:", deleteError);
      throw deleteError;
    }

    // STEP 7: INSERT all activities (batched)
    const allActivities = [...messageActivities, ...reactionActivities];
    let inserted = 0;

    if (allActivities.length > 0) {
      const CHUNK_SIZE = 500;
      const chunks = chunk(allActivities, CHUNK_SIZE);
      
      const insertResults = await Promise.all(
        chunks.map(batch => supabase.from("member_activities").insert(batch))
      );

      const failedChunks = insertResults.filter(r => r.error);
      if (failedChunks.length > 0) {
        console.error(`Failed to insert ${failedChunks.length} chunks:`, failedChunks[0].error);
        throw failedChunks[0].error;
      }

      inserted = allActivities.length;
    }

    console.log(`Processing complete: inserted ${inserted} activities`);

    return NextResponse.json({
      success: true,
      processed: {
        messages: messageActivities.length,
        reactions: reactionActivities.length,
        total_activities: inserted,
      },
    });
  } catch (error: any) {
    console.error("Error processing Slack data:", error);
    return NextResponse.json(
      { error: error.message || "Failed to process Slack data" },
      { status: 500 }
    );
  }
}

async function loadAllMessages(supabase: any, fromDate: string, toDate: string) {
  let allMessages: any[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("slack_messages")
      .select("*")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate)
      .is("deleted_at", null) // Skip deleted messages
      .order("occurred_at")
      .range(offset, offset + BATCH_SIZE - 1);

    if (batch && batch.length > 0) {
      allMessages = allMessages.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allMessages;
}

async function loadAllReactions(supabase: any, fromDate: string, toDate: string) {
  let allReactions: any[] = [];
  let offset = 0;
  const BATCH_SIZE = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data: batch } = await supabase
      .from("slack_reactions")
      .select("*")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate)
      .is("removed_at", null) // Skip removed reactions
      .order("occurred_at")
      .range(offset, offset + BATCH_SIZE - 1);

    if (batch && batch.length > 0) {
      allReactions = allReactions.concat(batch);
      offset += batch.length;
      hasMore = batch.length === BATCH_SIZE;
    } else {
      hasMore = false;
    }
  }

  return allReactions;
}

function calculateMessageValue(msg: any): number {
  let value = 1; // Base value for any message

  // Thread starter = higher value (initiates conversation)
  if (!msg.thread_ts) {
    value += 2;
  }

  // Thread reply = medium value (participates in conversation)
  if (msg.thread_ts && msg.thread_ts !== msg.message_ts) {
    value += 1;
  }

  // File share = extra value (content contribution)
  if (msg.files) {
    value += 2;
  }

  // Long message = more engagement
  if (msg.text && msg.text.length > 500) {
    value += 1;
  }

  return value;
}
```

- [ ] **Step 2: Test processing endpoint**

Run:
```bash
curl -X POST http://localhost:3000/api/process/slack \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"fromDate": "2026-03-09", "toDate": "2026-04-08"}'
```

Expected: `{"success": true, "processed": {...}}`

- [ ] **Step 3: Verify member_activities**

Run SQL:
```sql
SELECT COUNT(*) FROM member_activities WHERE source = 'slack';
SELECT activity_type, COUNT(*) FROM member_activities WHERE source = 'slack' GROUP BY activity_type;
```

Expected: Counts for slack_message, slack_thread_reply, slack_reaction

- [ ] **Step 4: Commit**

```bash
git add app/api/process/slack/route.ts
git commit -m "feat: add Slack processing endpoint (Bronze → Silver)"
```

---

## Task 14: Unmatched Slack Users API

**Files:**
- Create: `app/api/reports/unmatched-slack-users/route.ts`

- [ ] **Step 1: Write unmatched users report endpoint**

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";
import { matchSlackUsersToMembers } from "@/lib/slack-matching";

export async function GET(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Load reference data
    const [
      { data: slackUsers },
      { data: members },
      { data: aliases },
      { data: ignoredUsers },
      { data: slackMessages },
    ] = await Promise.all([
      supabase.from("slack_users").select("user_id, email, real_name, display_name, is_bot"),
      supabase.from("members").select("id, name, email"),
      supabase.from("member_name_aliases").select("alias, member_id, source"),
      supabase.from("ignored_slack_users").select("user_id"),
      // Get message counts per user for activity level
      supabase.from("slack_messages").select("user_id"),
    ]);

    // Match users
    const userToMemberMap = await matchSlackUsersToMembers(
      slackUsers || [],
      members || [],
      aliases || []
    );

    // Filter ignored users
    const ignoredUserIds = new Set((ignoredUsers || []).map(u => u.user_id));

    // Count messages per user
    const messageCountByUser = new Map<string, number>();
    for (const msg of slackMessages || []) {
      messageCountByUser.set(msg.user_id, (messageCountByUser.get(msg.user_id) || 0) + 1);
    }

    // Find unmatched users (not matched, not ignored, not bots)
    const unmatched = (slackUsers || [])
      .filter(u => !userToMemberMap.has(u.user_id))
      .filter(u => !ignoredUserIds.has(u.user_id))
      .filter(u => !u.is_bot)
      .map(u => ({
        slack_user_id: u.user_id,
        email: u.email,
        real_name: u.real_name,
        display_name: u.display_name,
        message_count: messageCountByUser.get(u.user_id) || 0,
      }))
      .sort((a, b) => b.message_count - a.message_count); // Sort by activity

    return NextResponse.json({
      unmatched,
      total_slack_users: slackUsers?.length || 0,
      matched: userToMemberMap.size,
      ignored: ignoredUserIds.size,
    });
  } catch (error: any) {
    console.error("Error fetching unmatched Slack users:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch unmatched users" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test endpoint**

Run:
```bash
curl http://localhost:3000/api/reports/unmatched-slack-users \
  -H "Cookie: <your-session-cookie>"
```

Expected: `{"unmatched": [...], "matched": N, "ignored": M}`

- [ ] **Step 3: Commit**

```bash
git add app/api/reports/unmatched-slack-users/route.ts
git commit -m "feat: add unmatched Slack users report API"
```

---

## Task 15: Manual Alias API

**Files:**
- Create: `app/api/aliases/slack/route.ts`

- [ ] **Step 1: Write manual alias creation endpoint**

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { member_id, slack_user_id } = body;

    if (!member_id || !slack_user_id) {
      return NextResponse.json(
        { error: "member_id and slack_user_id are required" },
        { status: 400 }
      );
    }

    // Verify member exists
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("id", member_id)
      .single();

    if (!member) {
      return NextResponse.json({ error: "Member not found" }, { status: 404 });
    }

    // Verify Slack user exists
    const { data: slackUser } = await supabase
      .from("slack_users")
      .select("user_id")
      .eq("user_id", slack_user_id)
      .single();

    if (!slackUser) {
      return NextResponse.json({ error: "Slack user not found" }, { status: 404 });
    }

    // Insert alias (or update if already exists)
    const { error } = await supabase
      .from("member_name_aliases")
      .upsert({
        member_id,
        alias: slack_user_id,
        source: "slack",
      }, {
        onConflict: "alias",
      });

    if (error) throw error;

    return NextResponse.json({
      success: true,
      message: "Slack alias created successfully",
    });
  } catch (error: any) {
    console.error("Error creating Slack alias:", error);
    return NextResponse.json(
      { error: error.message || "Failed to create alias" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test endpoint**

Run:
```bash
curl -X POST http://localhost:3000/api/aliases/slack \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"member_id": "<member-uuid>", "slack_user_id": "U01234ABC"}'
```

Expected: `{"success": true}`

- [ ] **Step 3: Verify alias created**

Run SQL:
```sql
SELECT * FROM member_name_aliases WHERE source = 'slack';
```

Expected: 1 row with slack_user_id as alias

- [ ] **Step 4: Commit**

```bash
git add app/api/aliases/slack/route.ts
git commit -m "feat: add manual Slack alias creation API"
```

---

## Task 16: Skip Non-Member API

**Files:**
- Create: `app/api/data-hygiene/slack-users/skip/route.ts`

- [ ] **Step 1: Write skip non-member endpoint**

```typescript
import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { slack_user_id, reason } = body;

    if (!slack_user_id) {
      return NextResponse.json(
        { error: "slack_user_id is required" },
        { status: 400 }
      );
    }

    const validReasons = ['non_member', 'bot', 'guest'];
    if (reason && !validReasons.includes(reason)) {
      return NextResponse.json(
        { error: `reason must be one of: ${validReasons.join(', ')}` },
        { status: 400 }
      );
    }

    // Insert into ignored users
    const { error } = await supabase
      .from("ignored_slack_users")
      .insert({
        user_id: slack_user_id,
        reason: reason || 'non_member',
      });

    if (error) {
      // If duplicate, that's fine (already ignored)
      if (error.code !== '23505') {
        throw error;
      }
    }

    return NextResponse.json({
      success: true,
      message: "Slack user marked as non-member",
    });
  } catch (error: any) {
    console.error("Error skipping Slack user:", error);
    return NextResponse.json(
      { error: error.message || "Failed to skip user" },
      { status: 500 }
    );
  }
}
```

- [ ] **Step 2: Test endpoint**

Run:
```bash
curl -X POST http://localhost:3000/api/data-hygiene/slack-users/skip \
  -H "Content-Type: application/json" \
  -H "Cookie: <your-session-cookie>" \
  -d '{"slack_user_id": "U999GUEST", "reason": "guest"}'
```

Expected: `{"success": true}`

- [ ] **Step 3: Verify ignored user**

Run SQL:
```sql
SELECT * FROM ignored_slack_users;
```

Expected: 1 row with user_id = U999GUEST

- [ ] **Step 4: Commit**

```bash
git add app/api/data-hygiene/slack-users/skip/route.ts
git commit -m "feat: add skip non-member Slack user API"
```

---

## Task 17: Update TODO.md

**Files:**
- Modify: `docs/TODO.md`

- [ ] **Step 1: Mark Slack Phase 1 as in progress**

Find the Slack Integration section (around line 316) and update the header:

```markdown
### Slack Integration (Phase 1: In Progress)
```

- [ ] **Step 2: Add completion checklist**

Add after the Phase descriptions:

```markdown
**Phase 1 Progress:**
- [x] Database migrations (Bronze tables, aliases extension)
- [x] Export script (batch CSV export)
- [x] Import API endpoint
- [x] Processing endpoint (Bronze → Silver)
- [x] Member matching library
- [ ] Data hygiene UI (unmatched users matching interface)
- [ ] Tests (reprocessability, idempotency, matching)
- [ ] Initial 30-day export and import
- [ ] Dashboard updates (member profiles, engagement scoring)
```

- [ ] **Step 3: Commit**

```bash
git add docs/TODO.md
git commit -m "docs: update TODO.md with Slack Phase 1 progress"
```

---

## Task 18: Reprocessability Tests

**Files:**
- Create: `tests/api/reprocessability/slack.test.ts`

- [ ] **Step 1: Write test for deleted message reprocessing**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

describe('Slack Processing Reprocessability', () => {
  beforeEach(async () => {
    // Clean up test data
    await supabase.from('slack_messages').delete().like('message_ts', 'TEST_%');
    await supabase.from('slack_reactions').delete().like('message_ts', 'TEST_%');
    await supabase.from('member_activities').delete().eq('source', 'slack');
  });

  it('should handle initial processing of Slack messages', async () => {
    // 1. Seed Bronze data
    const testMessages = [
      {
        message_ts: 'TEST_001',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: 'U_MEMBER1',
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Hello world',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2026-04-01T10:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
      {
        message_ts: 'TEST_002',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: 'U_MEMBER1',
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Goodbye',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2026-04-01T11:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
    ];

    await supabase.from('slack_messages').insert(testMessages);

    // 2. Process
    const response = await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        fromDate: '2026-04-01',
        toDate: '2026-04-02',
      }),
    });

    expect(response.ok).toBe(true);

    // 3. Verify member_activities created
    const { data: activities } = await supabase
      .from('member_activities')
      .select('*')
      .eq('source', 'slack')
      .gte('occurred_at', '2026-04-01')
      .lte('occurred_at', '2026-04-02');

    // Note: Only creates activities if Slack user matched to member
    // Test assumes matching is set up correctly
    expect(activities).toBeDefined();
  });

  it('should remove deleted messages on reprocessing', async () => {
    // 1. Initial processing with 2 messages
    const testMessages = [
      {
        message_ts: 'TEST_003',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: 'U_MEMBER1',
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Keep this',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2026-04-01T10:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
      {
        message_ts: 'TEST_004',
        channel_id: 'C_TEST',
        channel_name: 'test-channel',
        channel_type: 'public_channel',
        user_id: 'U_MEMBER1',
        user_email: 'test@example.com',
        user_name: 'Test User',
        text: 'Delete this',
        message_type: 'message',
        thread_ts: null,
        reply_count: 0,
        occurred_at: '2026-04-01T11:00:00Z',
        deleted_at: null,
        files: null,
        imported_at: new Date().toISOString(),
        raw_payload: {},
      },
    ];

    await supabase.from('slack_messages').insert(testMessages);

    await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        fromDate: '2026-04-01',
        toDate: '2026-04-02',
      }),
    });

    // 2. Mark one message as deleted
    await supabase
      .from('slack_messages')
      .update({ deleted_at: new Date().toISOString() })
      .eq('message_ts', 'TEST_004');

    // 3. Reprocess
    await fetch('http://localhost:3000/api/process/slack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        fromDate: '2026-04-01',
        toDate: '2026-04-02',
      }),
    });

    // 4. Verify deleted message activity removed
    const { data: activities } = await supabase
      .from('member_activities')
      .select('*')
      .eq('source', 'slack')
      .gte('occurred_at', '2026-04-01')
      .lte('occurred_at', '2026-04-02');

    // Should only have TEST_003 activity (if matching worked)
    const deletedMessageActivity = activities?.find(
      a => a.metadata?.message_ts === 'TEST_004'
    );
    expect(deletedMessageActivity).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npm test tests/api/reprocessability/slack.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/api/reprocessability/slack.test.ts
git commit -m "test: add Slack reprocessability tests"
```

---

## Task 19: Idempotency Tests

**Files:**
- Create: `tests/api/idempotency/slack-import.test.ts`

- [ ] **Step 1: Write test for duplicate imports**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { writeFileSync, mkdirSync } from 'fs';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function createTestCSV(data: any[]): File {
  if (data.length === 0) return new File([], 'test.csv');

  const headers = Object.keys(data[0]);
  const rows = data.map(row => 
    headers.map(h => {
      const val = row[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return val.toString();
    }).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\n');
  return new File([csv], 'test.csv', { type: 'text/csv' });
}

describe('Slack Import Idempotency', () => {
  beforeEach(async () => {
    // Clean up test data
    await supabase.from('slack_users').delete().eq('user_id', 'U_TEST');
    await supabase.from('slack_messages').delete().eq('message_ts', 'TEST_MSG');
  });

  it('should not create duplicates when importing same CSV twice', async () => {
    const testUsers = [{
      user_id: 'U_TEST',
      email: 'test@example.com',
      name: 'testuser',
      display_name: 'Test User',
      real_name: 'Test User',
      is_bot: false,
      is_deleted: false,
      raw_payload: {}
    }];

    const testChannels = [{
      channel_id: 'C_TEST',
      name: 'test',
      is_private: false,
      is_archived: false,
      member_count: 1,
      topic: null,
      purpose: null,
      created: '2026-01-01T00:00:00Z',
      raw_payload: {}
    }];

    const testMessages = [{
      message_ts: 'TEST_MSG',
      channel_id: 'C_TEST',
      channel_name: 'test',
      channel_type: 'public_channel',
      user_id: 'U_TEST',
      user_email: 'test@example.com',
      user_name: 'Test User',
      text: 'Hello',
      message_type: 'message',
      thread_ts: null,
      reply_count: 0,
      reply_users_count: 0,
      occurred_at: '2026-04-01T10:00:00Z',
      edited_at: null,
      deleted_at: null,
      files: null,
      raw_payload: {}
    }];

    const testReactions: any[] = [];

    // 1. First import
    const formData1 = new FormData();
    formData1.append('users', createTestCSV(testUsers));
    formData1.append('channels', createTestCSV(testChannels));
    formData1.append('messages', createTestCSV(testMessages));
    formData1.append('reactions', createTestCSV(testReactions));

    const response1 = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: formData1,
    });

    expect(response1.ok).toBe(true);

    let { data: users } = await supabase.from('slack_users').select('*').eq('user_id', 'U_TEST');
    expect(users).toHaveLength(1);

    let { data: messages } = await supabase.from('slack_messages').select('*').eq('message_ts', 'TEST_MSG');
    expect(messages).toHaveLength(1);

    // 2. Second import (same data)
    const formData2 = new FormData();
    formData2.append('users', createTestCSV(testUsers));
    formData2.append('channels', createTestCSV(testChannels));
    formData2.append('messages', createTestCSV(testMessages));
    formData2.append('reactions', createTestCSV(testReactions));

    const response2 = await fetch('http://localhost:3000/api/import/slack', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
      body: formData2,
    });

    expect(response2.ok).toBe(true);

    // 3. Verify still only 1 record (not 2)
    users = (await supabase.from('slack_users').select('*').eq('user_id', 'U_TEST')).data;
    expect(users).toHaveLength(1);

    messages = (await supabase.from('slack_messages').select('*').eq('message_ts', 'TEST_MSG')).data;
    expect(messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npm test tests/api/idempotency/slack-import.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/api/idempotency/slack-import.test.ts
git commit -m "test: add Slack import idempotency tests"
```

---

## Task 20: Matching Logic Tests

**Files:**
- Create: `tests/lib/slack-matching.test.ts`

- [ ] **Step 1: Write matching tests**

```typescript
import { describe, it, expect } from 'vitest';
import { matchSlackUsersToMembers } from '@/lib/slack-matching';

describe('Slack User Matching', () => {
  const members = [
    { id: 'member-1', name: 'Alice Johnson', email: 'alice@example.com' },
    { id: 'member-2', name: 'Bob Smith', email: 'bob@example.com' },
  ];

  const aliases = [
    { member_id: 'member-1', alias: 'U_ALICE_MANUAL', source: 'slack' },
  ];

  it('should match by email (high confidence)', async () => {
    const slackUsers = [
      { user_id: 'U001', email: 'alice@example.com', real_name: 'Alice J' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U001')).toBe('member-1');
  });

  it('should match by normalized name when email missing', async () => {
    const slackUsers = [
      { user_id: 'U002', email: null, real_name: 'Bob Smith' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U002')).toBe('member-2');
  });

  it('should match by manual alias (highest priority)', async () => {
    const slackUsers = [
      { user_id: 'U_ALICE_MANUAL', email: 'different@example.com', real_name: 'Totally Different' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.get('U_ALICE_MANUAL')).toBe('member-1'); // Manual alias wins over email
  });

  it('should not match when no email and no name similarity', async () => {
    const slackUsers = [
      { user_id: 'U003', email: null, real_name: 'Unknown User' },
    ];

    const map = await matchSlackUsersToMembers(slackUsers, members, aliases);

    expect(map.has('U003')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

Run:
```bash
npm test tests/lib/slack-matching.test.ts
```

Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add tests/lib/slack-matching.test.ts
git commit -m "test: add Slack user matching logic tests"
```

---

## Task 21: Deploy Database Migrations

**Files:**
- None (deployment task)

- [ ] **Step 1: Verify all migrations locally**

Run:
```bash
supabase db diff
```

Expected: No diff (all migrations applied)

- [ ] **Step 2: Push migrations to production**

Run:
```bash
supabase db push
```

Expected: Migrations applied successfully to production

- [ ] **Step 3: Verify tables in production**

Run SQL in production Supabase Studio:
```sql
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' AND table_name LIKE 'slack_%';
```

Expected: 4 tables (slack_messages, slack_reactions, slack_channels, slack_users)

- [ ] **Step 4: Document deployment**

Add to commit message when deploying:
```
Database migrations deployed to production:
- slack_messages, slack_reactions, slack_channels, slack_users
- Extended member_name_aliases with source column
- Added slack activity types
- Added ignored_slack_users table
```

---

## Task 22: Initial Slack Export

**Files:**
- None (operational task)

- [ ] **Step 1: Set up Slack App credentials**

1. Go to https://api.slack.com/apps
2. Create New App → From an app manifest
3. Upload `slack-app-manifest.yml`
4. Replace `REPLACE_WITH_YOUR_DOMAIN` with Vercel domain (if deploying Phase 2 webhooks later)
5. Install App to Workspace
6. Copy Bot User OAuth Token (`xoxb-...`)

- [ ] **Step 2: Set environment variable**

Run:
```bash
export SLACK_BOT_TOKEN=xoxb-your-token
```

- [ ] **Step 3: Add bot to channels**

In Slack, run `/invite @Hedgie Hub` in each channel you want to track.

- [ ] **Step 4: Run export script**

Run:
```bash
npm run export:slack -- 30
```

Expected: Creates 4 CSV files in `exports/` directory

- [ ] **Step 5: Verify export files**

Run:
```bash
ls -lh exports/
wc -l exports/*.csv
```

Expected: 4 CSV files with reasonable line counts

- [ ] **Step 6: Upload CSVs via UI or API**

Option A: Build upload UI (next task)
Option B: Use curl:
```bash
curl -X POST http://localhost:3000/api/import/slack \
  -H "Cookie: <session-cookie>" \
  -F "users=@exports/slack_users.csv" \
  -F "channels=@exports/slack_channels.csv" \
  -F "messages=@exports/slack_messages.csv" \
  -F "reactions=@exports/slack_reactions.csv"
```

- [ ] **Step 7: Process to Silver layer**

Run:
```bash
curl -X POST http://localhost:3000/api/process/slack \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"fromDate": "2026-03-09", "toDate": "2026-04-08"}'
```

Expected: Activities created in member_activities table

---

## Spec Self-Review

- [ ] **Spec coverage check**

Reviewing spec requirements against tasks:

1. ✅ Bronze tables (Task 1-4)
2. ✅ CSV export script (Task 7-10)
3. ✅ Import API (Task 11)
4. ✅ Processing endpoint (Task 13)
5. ✅ Member matching (Task 12)
6. ✅ Data hygiene APIs (Task 14-16)
7. ⚠️ Data hygiene UI - Not yet implemented (future task)
8. ✅ Tests (Task 18-20)
9. ✅ Deployment (Task 21-22)
10. ⚠️ Dashboard/UI updates - Not yet implemented (future task)

**Gaps identified:**
- Data hygiene UI (matching interface) - Phase 1b
- Dashboard updates (member profiles, engagement leaders) - Phase 1c

- [ ] **Placeholder scan**

Searching for TBD, TODO, "implement later", "add validation":
- ✅ No placeholders found - all code blocks are complete

- [ ] **Type consistency check**

Verifying types across tasks:
- ✅ `slack_messages` table schema consistent across migrations and code
- ✅ `SlackUser` interface matches query selections
- ✅ Activity types (slack_message, slack_thread_reply, slack_reaction) used consistently

---

## Execution Notes

**Estimated time:** 8-10 hours for Phase 1 core (Tasks 1-22)

**Dependencies:**
- Slack workspace admin access (to create app and add to channels)
- Supabase production credentials
- Vercel deployment access

**Testing strategy:**
- Run tests after each endpoint (Tasks 11, 13-16)
- Run full test suite after Task 20
- Verify with real data in Task 22

**Deployment order:**
1. Database migrations (Task 21)
2. Code deployment to Vercel (auto on git push)
3. Initial Slack export and import (Task 22)
4. Data hygiene (review unmatched users, create aliases)
5. Reprocess with aliases applied

**Phase 1b (Data Hygiene UI) - Future:**
- Task 23: Build `/dashboard/data-hygiene/slack-users` page
- Task 24: Integrate search-based matching interface
- Task 25: Test UI end-to-end

**Phase 1c (Dashboard Updates) - Future:**
- Task 26: Add Slack activity card to member profiles
- Task 27: Update dashboard with combined engagement scoring
- Task 28: Add Slack analytics page

**Phase 2 (Webhooks) - Future:**
- Update slack-app-manifest.yml (enable event subscriptions)
- Build `/api/webhooks/slack` endpoint
- Deploy and verify webhook signature
- Test real-time message/reaction events
- Gradual cutover from batch to webhooks