# Slack Channel Management

**Date:** 2026-04-22  
**Status:** Draft  
**Dependencies:** [Member Identity Management](./member-identity-management.md)  
**Blocks:** [Hiatus Automation](./hiatus-automation.md)

## Overview

### Problem Statement

Q&C uses Slack for community engagement, but channel access is manually managed:
- **Manual invites**: Admins manually add members to channels based on their subscription status
- **No automation**: When members go on hiatus or change subscriptions, admins must manually update their channel access
- **Inconsistent rules**: No centralized system for "who should have access to which channels"

### Solution

**Automated Slack channel management system:**
- Database-driven rules engine that defines which members should have access to which Slack channels based on triggers (status changes, milestones, program enrollment)
- Automatically grant/revoke Slack channel access when rules trigger
- Audit trail tracking who was granted/revoked access, when, and by which rule

## Goals

1. **Automated channel management** - Grant/revoke access based on rules (no manual intervention)
2. **Flexible rules engine** - Support status changes, program enrollment, milestone triggers
3. **Audit trail** - Track who was granted/revoked access, when, and by which rule
4. **Wildcard support** - Support `*` for "all channels" in revoke rules (e.g., hiatus)

## Non-Goals

- Slack engagement tracking (see [Slack Engagement Tracking](./slack-engagement-tracking.md))
- Slack bot commands or interactive features
- Automated outreach via Slack

## Success Metrics

- 100% of status changes trigger channel access updates automatically
- Zero manual Slack invites/removals after launch
- Audit trail captures all access grants/revokes with rule attribution

---

## Data Model

### Local Layer: `channel_access_rules`

Business rules defining when to grant/revoke Slack channel access.

```sql
CREATE TABLE channel_access_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_type TEXT NOT NULL, -- 'status_change', 'milestone', 'program_join'
  trigger_value JSONB NOT NULL, -- Trigger-specific data (e.g., {"from": "active", "to": "on_hiatus"})
  channels TEXT[] NOT NULL, -- Channel names to grant/revoke (supports '*' for all)
  action TEXT NOT NULL CHECK (action IN ('grant', 'revoke')),
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_channel_rules_active ON channel_access_rules(active) WHERE deleted_at IS NULL;
CREATE INDEX idx_channel_rules_trigger ON channel_access_rules(trigger_type);

COMMENT ON TABLE channel_access_rules IS 'LOCAL: Business rules - do not DELETE in reprocessing';
```

**Example Rules:**

```sql
-- Trial converts to paid → grant members-only channels
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'status_change',
  '{"from": "trial", "to": "active"}',
  ARRAY['members-only', 'accountability'],
  'grant',
  true
);

-- Hiatus start → revoke all channels
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'status_change',
  '{"from": "active", "to": "on_hiatus"}',
  ARRAY['*'],
  'revoke',
  true
);

-- 180 Program enrollment → grant program channels
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'program_join',
  '{"program": "180 Program"}',
  ARRAY['180-general', '180-resources'],
  'grant',
  true
);

-- 180 Program with cohort → grant cohort-specific channels
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'program_join',
  '{"program": "180 Program", "cohort": "2026-01"}',
  ARRAY['180-jan-2026', '180-jan-2026-accountability'],
  'grant',
  true
);

-- 30-day milestone → grant veteran channel
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'milestone',
  '{"days": 30}',
  ARRAY['30-day-veterans'],
  'grant',
  true
);
```

### Silver Layer: `member_slack_channels`

Tracks which Slack channels each member has access to (audit trail).

```sql
CREATE TABLE member_slack_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  slack_channel_id TEXT NOT NULL,
  slack_channel_name TEXT NOT NULL,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  granted_by_rule_id UUID REFERENCES channel_access_rules(id),
  revoked_at TIMESTAMP WITH TIME ZONE,
  revoked_by_rule_id UUID REFERENCES channel_access_rules(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(member_id, slack_channel_id)
);

CREATE INDEX idx_member_channels_member ON member_slack_channels(member_id);
CREATE INDEX idx_member_channels_active ON member_slack_channels(member_id) WHERE revoked_at IS NULL;

COMMENT ON TABLE member_slack_channels IS 'SILVER: Derived from channel_access_rules + Slack state';
```

---

## Rule Evaluation

### Function: `evaluateRulesForMember(memberId, triggerType, triggerData)`

**Returns**: `{ grant: string[], revoke: string[] }`

**Logic**:
1. Load all active rules matching `trigger_type`
2. Filter rules where `trigger_value` matches `triggerData`
3. Separate into grant/revoke channel lists
4. Handle wildcard `*` for revoke (fetches member's current channels)

**Trigger Types:**

- **`status_change`**: `{ from: 'active', to: 'on_hiatus' }`
- **`milestone`**: `{ days: 30 }`
- **`program_join`**: `{ program: '180 Program', cohort?: '2026-01' }`

**Example Implementation:**

```typescript
// lib/channel-rules/evaluator.ts
export async function evaluateRulesForMember(
  memberId: string,
  triggerType: TriggerType,
  triggerData: any
): Promise<{ grant: string[], revoke: string[] }> {
  const supabase = await createClient();
  
  const { data: rules } = await supabase
    .from("channel_access_rules")
    .select("*")
    .eq("trigger_type", triggerType)
    .eq("active", true)
    .is("deleted_at", null);
    
  if (!rules) return { grant: [], revoke: [] };
  
  const matchingRules = rules.filter(rule => ruleMatches(rule, triggerData));
  
  const grant: string[] = [];
  const revoke: string[] = [];
  
  for (const rule of matchingRules) {
    if (rule.action === 'grant') {
      grant.push(...rule.channels);
    } else {
      revoke.push(...rule.channels);
    }
  }
  
  // Handle wildcard '*' for revoke
  if (revoke.includes('*')) {
    const { data: currentChannels } = await supabase
      .from("member_slack_channels")
      .select("slack_channel_name")
      .eq("member_id", memberId)
      .is("revoked_at", null);
      
    if (currentChannels) {
      return { 
        grant: [], 
        revoke: currentChannels.map(ch => ch.slack_channel_name) 
      };
    }
  }
  
  return { grant, revoke };
}

function ruleMatches(rule: ChannelAccessRule, triggerData: any): boolean {
  switch (rule.trigger_type) {
    case 'status_change':
      return (
        rule.trigger_value.from === triggerData.from &&
        rule.trigger_value.to === triggerData.to
      );
      
    case 'milestone':
      return rule.trigger_value.days === triggerData.days;
      
    case 'program_join':
      const programMatches = rule.trigger_value.program === triggerData.program;
      
      // If rule specifies cohort, it must match
      if (rule.trigger_value.cohort) {
        return programMatches && rule.trigger_value.cohort === triggerData.cohort;
      }
      
      // If rule doesn't specify cohort, applies to all cohorts
      return programMatches;
      
    default:
      return false;
  }
}
```

---

## Applying Rules

### Function: `applyChannelAccessRules(memberId, triggerType, triggerData)`

**Steps**:
1. Evaluate rules → get grant/revoke lists
2. Fetch member's `slack_user_id`
3. For each channel to grant:
   - Get Slack channel ID (cached lookup)
   - Call `slack.conversations.invite()`
   - Record in `member_slack_channels`
4. For each channel to revoke:
   - Get Slack channel ID
   - Call `slack.conversations.kick()`
   - Update `member_slack_channels.revoked_at`

**Idempotency**: UPSERT on `(member_id, slack_channel_id)` prevents duplicate grants.

**Error Handling**: Log failures, continue processing remaining channels.

**Example Implementation:**

```typescript
// lib/channel-rules/apply.ts
export async function applyChannelAccessRules(
  memberId: string,
  triggerType: TriggerType,
  triggerData: any
) {
  "use step"; // Vercel Workflow step
  
  const supabase = await createClient();
  const slack = createSlackClient();
  
  const { grant, revoke } = await evaluateRulesForMember(
    memberId,
    triggerType,
    triggerData
  );
  
  const { data: member } = await supabase
    .from("members")
    .select("slack_user_id")
    .eq("id", memberId)
    .single();
    
  if (!member?.slack_user_id) {
    console.warn(`Member ${memberId} has no Slack user ID`);
    return { granted: [], revoked: [] };
  }
  
  const granted: string[] = [];
  const revoked: string[] = [];
  
  // Grant access to channels
  for (const channelName of grant) {
    try {
      const channelId = await getSlackChannelId(channelName, slack);
      if (!channelId) continue;
      
      await slack.conversations.invite({
        channel: channelId,
        users: member.slack_user_id
      });
      
      // Record in database
      await supabase.from("member_slack_channels").upsert({
        member_id: memberId,
        slack_channel_id: channelId,
        slack_channel_name: channelName
      }, { onConflict: 'member_id,slack_channel_id' });
      
      granted.push(channelName);
    } catch (error) {
      console.error(`Failed to grant ${channelName}:`, error);
    }
  }
  
  // Revoke access
  for (const channelName of revoke) {
    try {
      const channelId = await getSlackChannelId(channelName, slack);
      if (!channelId) continue;
      
      await slack.conversations.kick({
        channel: channelId,
        user: member.slack_user_id
      });
      
      await supabase
        .from("member_slack_channels")
        .update({ revoked_at: new Date().toISOString() })
        .eq("member_id", memberId)
        .eq("slack_channel_id", channelId);
        
      revoked.push(channelName);
    } catch (error) {
      console.error(`Failed to revoke ${channelName}:`, error);
    }
  }
  
  return { granted, revoked };
}

// Cache channel ID lookups
const channelIdCache = new Map<string, string>();

async function getSlackChannelId(channelName: string, slack: any): Promise<string | null> {
  if (channelIdCache.has(channelName)) {
    return channelIdCache.get(channelName)!;
  }
  
  try {
    const result = await slack.conversations.list({
      types: "public_channel,private_channel"
    });
    
    const channel = result.channels.find((ch: any) => ch.name === channelName);
    
    if (channel) {
      channelIdCache.set(channelName, channel.id);
      return channel.id;
    }
  } catch (error) {
    console.error(`Failed to list Slack channels:`, error);
  }
  
  return null;
}
```

---

## Milestone Checker (Cron)

**Route**: `GET /api/cron/check-milestones`

**Schedule**: Daily

**Logic**:
1. Load all milestone rules (get unique days)
2. Find members where `days_since_join` matches milestone days
3. For each match, trigger `applyChannelAccessRules(memberId, 'milestone', { days })`

**Example Implementation:**

```typescript
// app/api/cron/check-milestones/route.ts
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const supabase = await createClient();
  
  // Get milestone rules
  const { data: milestoneRules } = await supabase
    .from("channel_access_rules")
    .select("trigger_value")
    .eq("trigger_type", "milestone")
    .eq("active", true)
    .is("deleted_at", null);
    
  if (!milestoneRules) {
    return NextResponse.json({ success: true, processed: 0 });
  }
  
  const milestoneDays = [...new Set(milestoneRules.map(r => r.trigger_value.days))];
  
  // Find members who hit milestones today
  const { data: members } = await supabase
    .from("members")
    .select("id, days_since_join")
    .in("days_since_join", milestoneDays);
    
  if (!members) {
    return NextResponse.json({ success: true, processed: 0 });
  }
  
  // Trigger workflows
  for (const member of members) {
    await applyChannelAccessRules(member.id, 'milestone', {
      days: member.days_since_join
    });
  }
  
  return NextResponse.json({
    success: true,
    processed: members.length
  });
}
```

---

## Admin UI

### Channel Access Rules Management

**Location**: `/admin/data/channel-rules`

**Features**:

1. **Rules Table**
   - Columns: Trigger Type, Trigger Value, Channels, Action, Active, Created At
   - Actions: Edit, Deactivate, Delete
   - Sort by trigger type, created date

2. **Create/Edit Rule Form**
   - Select trigger type (status_change, milestone, program_join)
   - Dynamic form based on trigger type:
     - Status change: From status dropdown, To status dropdown
     - Milestone: Days input
     - Program join: Program name input, Cohort input (optional)
   - Channel multi-select or wildcard `*`
   - Action: Grant / Revoke
   - Active toggle

3. **Test Rule Button**
   - Select a member
   - Preview which channels would be granted/revoked
   - "Dry run" mode (doesn't actually call Slack API)

### Member Channel Access Audit

**Location**: `/admin/members/:id` (member detail page)

**Features**:

1. **Current Channels** (tabs)
   - Tab: Active Channels
   - Tab: Revoked Channels
   - Columns: Channel Name, Granted At, Granted By Rule, Revoked At, Revoked By Rule

2. **Manual Grant/Revoke**
   - Button: "Manually Grant Channel Access"
   - Button: "Manually Revoke Channel Access"
   - Creates record with `granted_by_rule_id = NULL` (manual action)

---

## Deployment

### Environment Variables

```bash
# Slack Bot OAuth Token (for API calls)
vercel env add SLACK_BOT_TOKEN production

# Cron secret for milestone checker
vercel env add CRON_SECRET production
```

### Database Migrations

```sql
-- supabase/migrations/20260422000001_create_channel_access_rules.sql
CREATE TABLE channel_access_rules (...);
CREATE TABLE member_slack_channels (...);
```

### Vercel Cron Configuration

**File**: `vercel.json` or `vercel.ts`

```json
{
  "crons": [
    {
      "path": "/api/cron/check-milestones",
      "schedule": "0 6 * * *"
    }
  ]
}
```

---

## Testing Requirements

### Rule Evaluation Tests

```typescript
describe('evaluateRulesForMember', () => {
  it('should match status_change rule', () => {
    // Test status change from 'active' to 'on_hiatus'
    // Verify returns revoke: ['*']
  });
  
  it('should match milestone rule', () => {
    // Test member with days_since_join = 30
    // Verify returns grant: ['30-day-veterans']
  });
  
  it('should match program_join with cohort', () => {
    // Test program_join with cohort '2026-01'
    // Verify returns grant: ['180-jan-2026']
  });
});
```

### Slack Integration Tests

```typescript
describe('applyChannelAccessRules', () => {
  it('should grant channel access via Slack API', () => {
    // Mock slack.conversations.invite
    // Verify called with correct channel_id and user_id
    // Verify record created in member_slack_channels
  });
  
  it('should revoke channel access via Slack API', () => {
    // Mock slack.conversations.kick
    // Verify revoked_at updated
  });
  
  it('should handle wildcard revoke', () => {
    // Member has access to 3 channels
    // Trigger status_change with revoke: ['*']
    // Verify all 3 channels revoked
  });
});
```

---

## Success Criteria

1. **Automation**:
   - [ ] Status changes automatically trigger channel access updates
   - [ ] Milestone checker runs daily and grants veteran channels
   - [ ] Program enrollment grants cohort-specific channels

2. **Data Integrity**:
   - [ ] Audit trail captures all grants/revokes with rule attribution
   - [ ] Wildcard `*` revoke works correctly for hiatus
   - [ ] Idempotent grants (re-running doesn't create duplicates)

3. **Admin Experience**:
   - [ ] Admin UI for creating/managing rules
   - [ ] Member detail page shows channel access history
   - [ ] Test rule functionality works (dry run)

---

## Future Enhancements

1. **Rule Priority**: Support rule ordering (execute high-priority rules first)
2. **Conditional Rules**: Support complex conditions (e.g., "if member attended >10 prickles AND is active")
3. **Scheduled Grants**: Support time-based grants (e.g., "grant access on 2026-05-01")
4. **Notification Templates**: Customizable email/Slack notifications when access changes
5. **Rule Analytics**: Track which rules fire most often, success/failure rates

---

## References

- **Hiatus Automation**: [./hiatus-automation.md](./hiatus-automation.md) - Uses channel rules for hiatus workflow
- **Slack API**: https://api.slack.com/methods/conversations.invite
- **Member Identity Management**: [./member-identity-management.md](./member-identity-management.md) - Member data model
