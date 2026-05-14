# Slack Engagement Tracking

**Date:** 2026-04-22  
**Status:** Draft  
**Dependencies:** [Member Identity Management](./member-identity-management.md)  
**Blocks:** None

## Overview

### Problem Statement

Prickle (Zoom) attendance alone doesn't capture all member engagement:
- Members active in Slack but skipping prickles (lurkers)
- Members inactive everywhere (high churn risk)
- No visibility into community participation outside writing sessions

### Solution

Track comprehensive Slack activity (messages, reactions, threads, file shares) as complementary signal to attendance:
- Import Slack data (Bronze layer)
- Match Slack users to members  
- Transform into `member_activities` (Silver layer)
- Calculate combined engagement scores (Gold layer)

## Goals

1. **Track comprehensive Slack engagement** - Messages, reactions, thread participation, file shares across all channels
2. **Unified engagement scoring** - Combine Prickle attendance + Slack activity for holistic member health
3. **Enhanced at-risk detection** - Use Slack activity as early warning signal (active in Slack but no Prickles = lurker, inactive everywhere = high risk)
4. **Data hygiene tools** - Admin UI for matching unmatched Slack users to members
5. **Real-time ready architecture** - Start with batch CSV import, design for future real-time webhook events

## Non-Goals

- Slack bot commands or interactive features
- Sentiment analysis or content moderation
- Member-to-member connection graphs (future)
- Automated outreach via Slack (future)

## Success Metrics

- 90%+ Slack user → member matching rate
- Combined engagement score visible on all member profiles
- At-risk detection includes Slack signals within 2 weeks
- Real-time webhook integration within 1 month

---

## Engagement Tracking Architecture

### Design Philosophy

**Event-ready batch architecture:**
- Bronze tables accept data from any source (CSV batch or webhook)
- Idempotent UPSERTs using natural keys (message_ts, channel_id)
- Processing logic agnostic to ingestion method
- Enables gradual migration: batch → batch+webhooks → webhooks only

**Read-through cache pattern:**
- Webhooks read from Bronze tables first (slack_users, slack_channels)
- Fall back to Slack API only if not found
- Auto-populate Bronze on cache miss
- No Redis/KV needed - Bronze tables are the cache

**Reprocessability:**
- Silver layer (member_activities) uses DELETE + INSERT pattern
- Bronze layer (slack_messages, slack_reactions) uses UPSERT
- Full reprocessing from Bronze maintains data integrity

---

## Data Model

### Bronze Layer (Raw Slack Data)

#### `slack_messages`

Raw Slack messages from all accessible channels, DMs, and threads.

```sql
CREATE TABLE slack_messages (
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
```

#### `slack_reactions`

Raw Slack reactions (emoji reactions on messages).

```sql
CREATE TABLE slack_reactions (
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
```

#### `slack_channels`

Slack channels catalog (public, private, DMs).

```sql
CREATE TABLE slack_channels (
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
```

#### `slack_users`

Slack users catalog (for matching to members).

```sql
CREATE TABLE slack_users (
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
```

#### `ignored_slack_users`

Non-members to exclude from matching reports.

```sql
CREATE TABLE ignored_slack_users (
    user_id TEXT PRIMARY KEY,
    reason TEXT, -- 'non_member', 'bot', 'guest'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

**Design Decisions:**

1. **UPSERT-friendly** - Unique indexes on natural keys enable idempotent imports
2. **Soft deletes** - `deleted_at`, `removed_at` preserve history for reprocessing
3. **Dual timestamps** - `occurred_at` (event time) vs `imported_at` (ingestion time)
4. **Full payload** - `raw_payload` JSONB for debugging and future fields
5. **Denormalized** - Store `user_email`, `channel_name` in messages table for faster queries
6. **No foreign keys in Bronze** - Raw data shouldn't enforce referential integrity (webhook events may arrive out of order)

### Silver Layer (Processed Data)

#### Extend `member_name_aliases`

Add support for Slack user ID aliases:

```sql
ALTER TABLE member_name_aliases 
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'zoom' 
    CHECK (source IN ('zoom', 'slack'));

CREATE INDEX idx_member_name_aliases_source ON member_name_aliases(source);
```

**Examples:**
- Zoom alias: `(member_id: uuid, alias: "Amanda L.", source: "zoom")`
- Slack alias: `(member_id: uuid, alias: "U01234ABC", source: "slack")`

#### Extend `activity_types`

Add Slack-specific activity types:

```sql
INSERT INTO activity_types (code, name, category, default_engagement_value, description) VALUES
('slack_message', 'Slack Message', 'communication', 1, 'Posted a message in Slack'),
('slack_thread_reply', 'Slack Thread Reply', 'communication', 2, 'Replied in a Slack thread'),
('slack_reaction', 'Slack Reaction', 'communication', 1, 'Reacted to a Slack message')
ON CONFLICT (code) DO UPDATE SET 
  default_engagement_value = EXCLUDED.default_engagement_value,
  description = EXCLUDED.description;
```

#### Transform into `member_activities`

Slack messages and reactions are transformed into `member_activities` records (existing table).

**Engagement Value Calculation:**

```typescript
function calculateMessageValue(msg: SlackMessage): number {
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
  if (msg.files && msg.files.length > 0) {
    value += 2;
  }
  
  // Long message = more engagement
  if (msg.text && msg.text.length > 500) {
    value += 1;
  }
  
  return value;
}
```

### Gold Layer (Analytics)

#### Update `member_metrics.engagement_score`

Existing calculation + Slack activity:

```sql
UPDATE member_metrics mm
SET engagement_score = (
  -- Prickle attendance (existing)
  COALESCE(mm.prickles_last_30_days * 5, 0) +
  
  -- Slack activity (new)
  COALESCE((
    SELECT SUM(engagement_value)
    FROM member_activities ma
    WHERE ma.member_id = mm.member_id
      AND ma.source = 'slack'
      AND ma.occurred_at >= NOW() - INTERVAL '30 days'
  ), 0)
);
```

---

## Member Matching Strategy

### Matching Algorithm

**Priority order** (highest to lowest confidence):

1. **Manual alias** - Admin-created mapping in `member_name_aliases` (source='slack')
2. **Email match** - Slack user email = member email (case-insensitive)
3. **Normalized name match** - Use existing `normalize_name()` function
4. **Fuzzy name match** - Trigram similarity (if implemented)

**Implementation:**

```typescript
async function matchSlackUsersToMembers(): Promise<Map<string, string>> {
  const { data: slackUsers } = await supabase.from("slack_users").select("*");
  const { data: members } = await supabase.from("members").select("id, email, name");
  const { data: aliases } = await supabase
    .from("member_name_aliases")
    .select("member_id, alias")
    .eq("source", "slack");
  
  const map = new Map<string, string>();
  const unmatchedSlackUsers = [];
  
  for (const slackUser of slackUsers) {
    let memberId: string | null = null;
    
    // 1. Manual alias (highest priority)
    const alias = aliases.find(a => a.alias === slackUser.user_id);
    if (alias) {
      memberId = alias.member_id;
    }
    
    // 2. Email match
    if (!memberId && slackUser.email) {
      const member = members.find(m => 
        m.email.toLowerCase() === slackUser.email.toLowerCase()
      );
      if (member) {
        memberId = member.id;
      }
    }
    
    // 3. Name matching (using existing normalize_name logic)
    if (!memberId && slackUser.real_name) {
      const member = members.find(m => 
        normalize_name(m.name) === normalize_name(slackUser.real_name)
      );
      if (member) {
        memberId = member.id;
      }
    }
    
    if (memberId) {
      map.set(slackUser.user_id, memberId);
    } else {
      unmatchedSlackUsers.push(slackUser);
    }
  }
  
  if (unmatchedSlackUsers.length > 0) {
    console.log(`Unmatched Slack users: ${unmatchedSlackUsers.length}`);
  }
  
  return map;
}
```

### Data Hygiene UI

**New route:** `/dashboard/data-hygiene/slack-users`

Search-based interface for matching unmatched Slack users (mirrors existing `/dashboard/data-hygiene/unmatched-zoom` pattern):

**Features:**
- Table of unmatched Slack users (sorted by message count desc)
- Search bar per user: "Search members..." (live search)
- Click member → create alias mapping
- "Skip" button → add to `ignored_slack_users`
- Activity preview (recent messages/channels)

**API Endpoints:**

```typescript
// Get unmatched users
GET /api/reports/unmatched-slack-users
{
  unmatched: [
    {
      slack_user_id: "U01234ABC",
      email: "personal@gmail.com", // May be null
      real_name: "Johnny",
      display_name: "johnny_writes",
      message_count: 47,
      first_seen: "2026-03-15",
      last_seen: "2026-04-08"
    }
  ]
}

// Create manual mapping
POST /api/aliases/slack
{
  member_id: "uuid",
  slack_user_id: "U01234ABC"
}

// Skip non-member
POST /api/data-hygiene/slack-users/skip
{
  slack_user_id: "U01234ABC",
  reason: "non_member"
}
```

**Dashboard Widget:**

Add to main dashboard:

```
┌─ Data Quality ────────────────┐
│ ✓ Zoom matching: 95% (12 pending)
│ ⚠ Slack matching: 85% (8 pending)  
│ ✓ Calendar hosts: 100%
│                                
│ [Review unmatched users →]    
└────────────────────────────────┘
```

---

## Data Ingestion

### Phase 1: Batch CSV Export (Now)

**Export Script:** `scripts/export-slack-data.ts`

Node.js script using Slack SDK to export 30 days of history → CSV files.

**Key features:**
- Fetches users, channels, messages, reactions
- Respects rate limits (50 requests/min, sleep between channels)
- Outputs to `exports/*.csv`
- Handles pagination (cursor-based)
- Filters out join/leave messages

**Usage:**

```bash
mkdir -p exports
SLACK_BOT_TOKEN=xoxb-your-token npm run export:slack
```

**Import Endpoint:** `/api/import/slack`

Mirrors existing `/api/import/zoom`, `/api/import/members` pattern:

```typescript
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const usersFile = formData.get('users') as File;
  const channelsFile = formData.get('channels') as File;
  const messagesFile = formData.get('messages') as File;
  const reactionsFile = formData.get('reactions') as File;
  
  // Parse CSVs
  const users = await parseCSV(usersFile);
  const channels = await parseCSV(channelsFile);
  const messages = await parseCSV(messagesFile);
  const reactions = await parseCSV(reactionsFile);
  
  // UPSERT to Bronze tables (idempotent)
  await supabase.from('slack_users').upsert(users, { onConflict: 'user_id' });
  await supabase.from('slack_channels').upsert(channels, { onConflict: 'channel_id' });
  await supabase.from('slack_messages').upsert(messages, { onConflict: 'channel_id,message_ts' });
  await supabase.from('slack_reactions').upsert(reactions, { onConflict: 'channel_id,message_ts,reaction,user_id' });
  
  return NextResponse.json({ success: true, imported: { users: users.length, ... } });
}
```

**UI:** Add to `/dashboard/import` page for manual CSV upload.

### Phase 2: Real-Time Events API (Later)

**Webhook Endpoint:** `/api/webhooks/slack`

Receives Slack Events API callbacks in real-time.

**Key features:**
- Slack signature verification (prevent spoofing)
- Handle URL verification challenge
- Return 200 within 3 seconds (Slack requirement)
- Read-through cache: check Bronze tables before calling Slack API

**Event handlers:**
- `message` → UPSERT slack_messages
- `reaction_added` → UPSERT slack_reactions
- `reaction_removed` → UPDATE slack_reactions (set removed_at)
- `message_deleted` → UPDATE slack_messages (set deleted_at)
- `message_changed` → UPDATE slack_messages (set edited_at, new text)

**Read-through cache example:**

```typescript
async function getChannelInfo(channelId: string) {
  const supabase = await createClient();
  
  // 1. Try local DB first (cache hit)
  const { data: channel } = await supabase
    .from('slack_channels')
    .select('name, is_private')
    .eq('channel_id', channelId)
    .single();
  
  if (channel) {
    return { name: channel.name, type: channel.is_private ? 'private_channel' : 'public_channel' };
  }
  
  // 2. Cache miss - fetch from Slack API
  const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
  const result = await slack.conversations.info({ channel: channelId });
  
  // 3. Store in Bronze for future lookups
  await supabase.from('slack_channels').upsert({
    channel_id: channelId,
    name: result.channel.name,
    // ... other fields
  }, { onConflict: 'channel_id' });
  
  return { name: result.channel.name, type: ... };
}
```

**Benefits:**
- 99% of webhook events hit local DB (fast, no rate limits)
- Auto-populates Bronze when new users/channels appear
- No Redis/KV needed

### Transition Strategy: Batch → Real-Time

**Week 1: Batch only**
- Run export script
- Import CSVs
- Process to member_activities

**Week 2: Enable webhooks**
- Deploy webhook endpoint
- Enable Event Subscriptions in Slack App
- Both batch + webhooks running (overlap)
- Bronze tables UPSERT = no duplicates

**Week 3: Verify webhook coverage**
- Compare batch vs webhook data
- Ensure no gaps
- Monitor for missed events

**Week 4: Disable batch script**
- Webhooks fully proven
- Keep script for backfills only

---

## Processing Logic

### Processing Endpoint: `/api/process/slack`

Transforms Bronze Slack data → Silver `member_activities`.

**DELETE + INSERT pattern** (reprocessable):

```typescript
export async function POST(request: NextRequest) {
  const { fromDate, toDate } = await request.json();
  
  // 1. DELETE existing Slack activities in date range
  await supabase
    .from("member_activities")
    .delete()
    .eq("source", "slack")
    .gte("occurred_at", fromDate)
    .lte("occurred_at", toDate);
  
  // 2. Load Bronze Slack data in date range (with pagination)
  const slackMessages = await loadAllMessages(fromDate, toDate);
  const slackReactions = await loadAllReactions(fromDate, toDate);
  
  // 3. Match Slack users to members (in memory)
  const userToMemberMap = await matchSlackUsersToMembers();
  
  // 4. Transform messages → member_activities
  const messageActivities = slackMessages
    .map(msg => {
      const memberId = userToMemberMap.get(msg.user_id);
      if (!memberId) return null; // Skip non-members
      
      return {
        member_id: memberId,
        activity_type: msg.thread_ts && msg.thread_ts !== msg.message_ts 
          ? 'slack_thread_reply' 
          : 'slack_message',
        activity_category: 'communication',
        title: `Posted in #${msg.channel_name}`,
        description: msg.text?.substring(0, 200),
        metadata: {
          channel_id: msg.channel_id,
          channel_name: msg.channel_name,
          message_ts: msg.message_ts,
          thread_ts: msg.thread_ts,
          has_files: msg.files?.length > 0
        },
        related_id: `${msg.channel_id}:${msg.message_ts}`,
        engagement_value: calculateMessageValue(msg),
        occurred_at: msg.occurred_at,
        source: 'slack'
      };
    })
    .filter(a => a !== null);
  
  // 5. Transform reactions → member_activities
  const reactionActivities = slackReactions
    .map(reaction => {
      const memberId = userToMemberMap.get(reaction.user_id);
      if (!memberId) return null;
      
      return {
        member_id: memberId,
        activity_type: 'slack_reaction',
        activity_category: 'communication',
        title: `Reacted :${reaction.reaction}:`,
        metadata: {
          channel_id: reaction.channel_id,
          message_ts: reaction.message_ts,
          reaction: reaction.reaction
        },
        related_id: `${reaction.channel_id}:${reaction.message_ts}`,
        engagement_value: 1,
        occurred_at: reaction.occurred_at,
        source: 'slack'
      };
    })
    .filter(a => a !== null);
  
  // 6. INSERT all activities (batched, with pagination)
  const allActivities = [...messageActivities, ...reactionActivities];
  await batchInsert(supabase, "member_activities", allActivities, 500);
  
  return NextResponse.json({
    success: true,
    processed: {
      messages: messageActivities.length,
      reactions: reactionActivities.length,
      total_activities: allActivities.length
    }
  });
}
```

**Pagination required** (Supabase 1000-row limit):

```typescript
async function loadAllMessages(fromDate: string, toDate: string) {
  let allMessages = [];
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
```

---

## UI Changes

### Member Profile Enhancements

**Route:** `/dashboard/members/[id]`

Add new `SlackActivityCard` component:

**Features:**
- Summary stats (messages, reactions, threads - last 30 days)
- Active channels (badges showing channel names and message counts)
- Recent activity timeline (messages, reactions with previews)

**API:** `GET /api/members/[id]/slack-activity`

```json
{
  "summary": {
    "messages_30d": 47,
    "reactions_30d": 89,
    "threads_30d": 12,
    "active_channels": [
      { "channel_id": "C123", "name": "accountability", "message_count": 23 }
    ]
  },
  "recent_activity": [
    {
      "type": "slack_message",
      "channel_name": "accountability",
      "occurred_at": "2026-04-08T14:00:00Z",
      "preview": "Just finished my 1000 word sprint..."
    }
  ]
}
```

### Dashboard Updates

**Route:** `/dashboard`

**New widget: Combined Engagement Leaders**

Shows top members by combined Prickle + Slack engagement:

| Member | Prickles | Slack | Score |
|--------|----------|-------|-------|
| Alice Johnson | 12 sessions | 47 messages | 107 |

**Updated widget: At-Risk Members**

Enhanced to show both Prickle and Slack signals:

| Member | Status | Notes | Action |
|--------|--------|-------|--------|
| Bob Smith | 🔴 0 Prickles, ⚠️ 2 Slack msgs | Down from avg 8 Prickles, 25 msgs | Reach Out |

**At-risk detection logic:**
- No Prickles in 30d + Low Slack (<5 messages) = High risk
- Decline from baseline (was 25 msg/mo, now 2) = Medium risk
- Active Slack but no Prickles = "Lurker" (different outreach)

### New Page: Slack Analytics

**Route:** `/dashboard/slack`

Dedicated Slack analytics dashboard:

**Sections:**
1. Overview cards (total messages, active members, active channels, avg daily messages)
2. Channel health table (messages, active members, trend per channel)
3. Activity over time chart (line chart of messages per day)

---

## Testing Strategy

### Reprocessability Tests

```typescript
// tests/api/reprocessability/slack.test.ts
it('should remove deleted messages on reprocessing', async () => {
  // 1. Seed and process
  await seedSlackMessages([...]);
  await POST('/api/process/slack', { fromDate, toDate });
  
  // 2. Mark message as deleted
  await markDeleted(messageTs);
  
  // 3. Reprocess
  await POST('/api/process/slack', { fromDate, toDate });
  
  // 4. Verify activity removed
  const activities = await getActivities('slack');
  expect(activities.find(a => a.metadata.message_ts === messageTs)).toBeUndefined();
});
```

### Idempotency Tests

```typescript
// tests/api/idempotency/slack-import.test.ts
it('should not create duplicates when importing same CSV twice', async () => {
  const csv = createCSV([...]);
  await POST('/api/import/slack', { messages: csv });
  await POST('/api/import/slack', { messages: csv });
  
  const messages = await supabase.from('slack_messages').select('*');
  expect(messages.data).toHaveLength(1); // Not 2
});
```

### Member Matching Tests

```typescript
// tests/lib/slack-matching.test.ts
it('should match by manual alias (highest priority)', async () => {
  const member = await seedMember({ email: 'alice@example.com' });
  await seedSlackUser({ user_id: 'U999', email: 'different@example.com' });
  await seedAlias({ member_id: member.id, alias: 'U999', source: 'slack' });
  
  const map = await matchSlackUsersToMembers();
  expect(map.get('U999')).toBe(member.id); // Manual alias wins
});
```

### Webhook Event Tests

```typescript
// tests/api/webhooks/slack.test.ts
it('should handle message event and create Bronze record', async () => {
  const event = createSlackEvent({ type: 'message', text: 'Hello' });
  await POST('/api/webhooks/slack', event);
  
  const message = await getSlackMessage(event.ts);
  expect(message.text).toBe('Hello');
});
```

---

## Deployment

### Slack App Setup

1. **Create Slack App**
   - Visit https://api.slack.com/apps
   - Create New App → From an app manifest
   - Upload `slack-app-manifest.yml` from repo
   - Replace `REPLACE_WITH_YOUR_DOMAIN` with Vercel domain

2. **Install to Workspace**
   - Install App → Copy Bot User OAuth Token (`xoxb-...`)
   - Basic Information → Copy Signing Secret

3. **Add Bot to Channels**
   - Run `/invite @Hedgie Hub` in each channel

### Environment Variables

```bash
# Phase 1: Batch Export
vercel env add SLACK_BOT_TOKEN production

# Phase 2: Webhooks (add later)
vercel env add SLACK_SIGNING_SECRET production
```

### Database Migrations

```bash
# Create migrations
supabase/migrations/20260408120000_add_slack_bronze_tables.sql
supabase/migrations/20260408120001_add_source_to_aliases.sql
supabase/migrations/20260408120002_add_slack_activity_types.sql
supabase/migrations/20260408120003_add_ignored_slack_users.sql

# Apply locally
supabase db reset

# Deploy to production
supabase db push
```

### Deployment Checklist

**Phase 1: Batch Import (Week 1)**
- [ ] Create Slack app and install to workspace
- [ ] Add bot to all relevant channels
- [ ] Add `SLACK_BOT_TOKEN` to Vercel env
- [ ] Deploy database migrations
- [ ] Deploy export script
- [ ] Run initial 30-day export
- [ ] Import CSVs via UI
- [ ] Process to Silver layer
- [ ] Review data hygiene (unmatched users)
- [ ] Create manual aliases
- [ ] Reprocess and verify dashboard

**Phase 2: Real-Time Webhooks (Week 2+)**
- [ ] Add `SLACK_SIGNING_SECRET` to Vercel env
- [ ] Deploy webhook endpoint
- [ ] Enable Event Subscriptions in Slack app
- [ ] Test with sample message/reaction
- [ ] Monitor for 1 week (overlap with batch)
- [ ] Verify coverage (no gaps)
- [ ] Disable batch script

---

## Migration Plan

### 30-Day Backfill (Week 1)

```bash
# Export last 30 days
SLACK_BOT_TOKEN=xoxb-... npm run export:slack -- --days 30

# Import via UI or API
# Upload exports/*.csv to /dashboard/import

# Process to Silver
POST /api/process/slack
{
  "fromDate": "2026-03-09",
  "toDate": "2026-04-08"
}
```

### TODO: 60+ Day Backfill

**Options:**
- **Upgrade Slack to paid** (if possible) → export 90 days total
- **Request workspace export** from Slack admin (full history)
- **Accept 30-day history** as starting point

**Priority:** Medium (nice-to-have, not critical for launch)

---

## Future Enhancements

**Phase 3+ (Not in this spec):**
- DM metadata tracking (who's talking to who)
- Sentiment analysis on messages
- Member-to-member connection graph
- Channel recommendation engine
- Automated outreach to at-risk members
- Slack bot commands (`/prickle-stats @alice`)
- Integration with email, website analytics

---

## Security & Privacy

### Data Collection

**What we store:**
- Full message content (all accessible channels)
- User emails (for matching)
- Reaction data
- DM metadata (if bot added to DM)
- File metadata (not file contents)

**What we skip:**
- Channels bot is not added to
- Archived channels (configurable)
- Bot messages (join/leave notifications)

### Access Control

**Slack Bot Permissions:**
- Read-only (cannot post messages)
- Requires explicit channel invitation
- OAuth scopes clearly documented

**Hedgie Hub:**
- Existing RLS policies apply
- Only authenticated admins can view Slack data
- Manual alias creation requires admin role

### Compliance

- All data stored in Supabase (same privacy policy as existing data)
- Soft deletes preserve audit trail
- Full reprocessability = data corrections possible
- Slack data not shared externally

---

## Open Questions

1. **Backfill older data** - Should we upgrade Slack plan temporarily to get 60+ more days?
2. **Private channels** - Should we create separate bot invite list for private channels vs public?
3. **DM tracking** - Should we enable DM tracking or skip for privacy?
4. **Data retention** - Should we auto-archive Slack data older than 1 year?

**Decisions:**
- Will decide on backfill after seeing 30-day data quality
- Private channels: Add bot manually as needed (not auto-invite)
- DM tracking: Enable for now, can disable if privacy concerns arise
- Data retention: No archival for now (Bronze layer is cheap)

---

## Success Criteria

**Launch (Week 1):**
- ✅ 30 days of Slack data imported
- ✅ 90%+ Slack users matched to members
- ✅ Combined engagement score visible on member profiles
- ✅ Data hygiene UI functional

**Maturity (Week 4):**
- ✅ Real-time webhooks enabled
- ✅ At-risk detection includes Slack signals
- ✅ Dashboard widgets show Slack analytics
- ✅ Community managers using Slack data for outreach decisions

---

## References

- Slack API Documentation: https://api.slack.com/
- Existing patterns: `/api/import/zoom`, `/api/process/calendar`
- Related specs: `docs/KAJABI_DATA_MODEL.md`, `supabase/ARCHITECTURE.md`
