# Hiatus Automation

**Date:** 2026-04-22  
**Status:** Draft  
**Dependencies:**
- [Member Identity Management](./member-identity-management.md)
- [Slack Channel Management](./slack-channel-management.md)  
**Blocks:** None

---

## Overview

### Problem Statement

Members can take breaks from Q&C through hiatus periods, but the process is currently manual:
- **Manual Stripe pause**: Admin manually pauses subscription in Stripe dashboard
- **Manual Slack removal**: Admin manually removes member from all Slack channels
- **Manual tracking**: Hiatus dates tracked in spreadsheets
- **Manual resume**: Admin manually resumes subscription and re-invites to Slack
- **No automation**: Risk of forgetting to resume, inconsistent process

### Solution

**Automated hiatus workflows:**
- Admin triggers hiatus via UI → workflow pauses Stripe subscription, removes from Slack channels, sends confirmation email
- Auto-resume on scheduled date → workflow resumes subscription, re-invites to Slack, sends welcome-back email
- Audit trail in `member_hiatus_history` table

---

## Data Model

### Local Layer: `member_hiatus_history`

Tracks all hiatus periods for members (operational data we own).

```sql
CREATE TABLE member_hiatus_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE,
  auto_resume_date DATE,
  reason TEXT,
  workflow_run_id TEXT, -- Vercel Workflow run ID for observability
  stripe_pause_id TEXT, -- Stripe subscription pause reference
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_hiatus_member ON member_hiatus_history(member_id);
CREATE INDEX idx_hiatus_auto_resume ON member_hiatus_history(auto_resume_date) WHERE end_date IS NULL;
CREATE INDEX idx_hiatus_active ON member_hiatus_history(member_id) WHERE end_date IS NULL;

COMMENT ON TABLE member_hiatus_history IS 'LOCAL: Operational data - do not DELETE in reprocessing';
```

### Silver Layer: Update `members`

Add hiatus-related status value.

```sql
-- Extend members.status enum
ALTER TABLE members 
  ADD CONSTRAINT members_status_check 
  CHECK (status IN ('active', 'on_hiatus', 'cancelled', 'trial'));
```

---

## Workflows

### Start Hiatus Workflow

**Trigger**: `POST /admin/members/:id/hiatus/start`

**Input**:
```typescript
{
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  reason?: string;
}
```

**Steps**:

1. **Create hiatus record**
   - Insert into `member_hiatus_history`
   - Set `workflow_run_id`, `start_date`, `auto_resume_date`

2. **Pause Stripe subscriptions**
   - Find all active subscriptions for member (`member_subscriptions` table)
   - For each: `stripe.subscriptions.update({ pause_collection: { behavior: 'void', resumes_at } })`
   - Update `member_subscriptions.pause_resumes_at`

3. **Remove from Slack channels** (via [Slack Channel Management](./slack-channel-management.md))
   - Trigger Channel Access Rule: `status_change` from `active` to `on_hiatus`
   - Rule evaluates to `revoke: ['*']` (all channels)
   - Call `applyChannelAccessRules(memberId, 'status_change', { from: 'active', to: 'on_hiatus' })`

4. **Update member status**
   - Set `members.status = 'on_hiatus'`

5. **Send confirmation email**
   - Use Resend API
   - Template: "Your hiatus has been confirmed through {endDate}"

**Output**:
```typescript
{
  success: true,
  hiatusId: string,
  subscriptionsPaused: number,
  channelsRemoved: number
}
```

### End Hiatus Workflow

**Trigger**: 
- Manual: `POST /admin/members/:id/hiatus/end`
- Automatic: Daily cron checks `member_hiatus_history` for `auto_resume_date = today`

**Steps**:

1. **Resume Stripe subscriptions**
   - Find paused subscriptions (`pause_resumes_at IS NOT NULL`)
   - For each: `stripe.subscriptions.update({ pause_collection: null })`
   - Clear `member_subscriptions.pause_resumes_at`

2. **Re-invite to Slack channels** (via [Slack Channel Management](./slack-channel-management.md))
   - Trigger Channel Access Rule: `status_change` from `on_hiatus` to `active`
   - Finds previously revoked channels in `member_slack_channels` (WHERE `revoked_at IS NOT NULL`)
   - Re-invites to those channels
   - Clears `revoked_at`

3. **Update member status**
   - Set `members.status = 'active'`

4. **Close hiatus record**
   - Update `member_hiatus_history.end_date = today`

5. **Send welcome-back email**
   - Template: "Welcome back! You've been re-invited to {channels}"

**Output**:
```typescript
{
  success: true,
  channelsRestored: string[]
}
```

---

## API Routes

### POST /admin/members/:id/hiatus/start

**Access**: Admin only

**Request Body**:
```typescript
{
  startDate: string;
  endDate: string;
  reason?: string;
}
```

**Response**:
```typescript
{
  success: boolean;
  hiatusId: string;
  subscriptionsPaused: number;
  channelsRemoved: number;
}
```

**Implementation**:
```typescript
import { start } from "workflow/api";
import { startHiatusWorkflow } from "@/workflows/hiatus/start";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { startDate, endDate, reason } = await request.json();
  
  const result = await start(startHiatusWorkflow, {
    memberId: params.id,
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    reason
  });
  
  return NextResponse.json(result);
}
```

### POST /admin/members/:id/hiatus/end

**Access**: Admin only

**Response**:
```typescript
{
  success: boolean;
  channelsRestored: string[];
}
```

### GET /api/cron/auto-resume-hiatus

**Schedule**: Daily at 6am

**Logic**:
1. Find members with `auto_resume_date = today` AND `end_date IS NULL`
2. For each, trigger `endHiatusWorkflow`

**Authorization**: Bearer token (Vercel cron secret)

---

## Admin UI

### Hiatus Management Page

**Location**: `/admin/members/:id` (member detail page)

**Features**:

1. **Current Hiatus Status** (if `status = 'on_hiatus'`)
   - Display hiatus dates
   - Display reason
   - Button: "End Hiatus Early"

2. **Start Hiatus Form** (if `status = 'active'`)
   - Date picker: Start Date
   - Date picker: End Date (auto-resume date)
   - Textarea: Reason (optional)
   - Preview: "Will pause {N} subscriptions and remove from {M} Slack channels"
   - Button: "Start Hiatus"

3. **Hiatus History Table**
   - Columns: Start Date, End Date, Reason, Channels Removed, Status
   - Sortable by date

---

## Testing Requirements

### Workflow Tests

**Start Hiatus:**
1. Creates hiatus record
2. Pauses Stripe subscription with correct resume date
3. Removes from all Slack channels
4. Updates member status to `on_hiatus`
5. Sends confirmation email

**End Hiatus:**
1. Resumes Stripe subscription
2. Re-invites to previously revoked channels
3. Updates member status to `active`
4. Closes hiatus record
5. Sends welcome-back email

### Integration Tests

**Auto-resume cron:**
1. Finds members with `auto_resume_date = today`
2. Triggers end workflow for each
3. Skips members already resumed manually

**Idempotency:**
1. Re-running start workflow with same data doesn't create duplicate hiatus records
2. Re-running end workflow doesn't fail if already ended

---

## Success Criteria

1. **Automation**:
   - [ ] Admin can start hiatus via UI (no Stripe dashboard access needed)
   - [ ] Subscription pauses automatically
   - [ ] Slack channels revoked automatically
   - [ ] Auto-resume triggers on scheduled date

2. **Data Integrity**:
   - [ ] Hiatus history preserved (audit trail)
   - [ ] No orphaned Stripe pauses (workflow_run_id tracked)
   - [ ] Member re-invited to same channels they had before hiatus

3. **User Experience**:
   - [ ] Confirmation email sent immediately
   - [ ] Welcome-back email sent on resume
   - [ ] Admin UI shows current hiatus status

---

## Future Enhancements

1. **Self-service hiatus**: Members trigger their own hiatus via member portal
2. **Flexible resume**: Allow members to extend hiatus before auto-resume date
3. **Grace period**: Keep Slack access for 3 days after pause (avoid accidental removal)
4. **Analytics**: Track hiatus patterns, return rates, typical duration
5. **Prorated refunds**: Calculate and issue refunds if hiatus starts mid-billing cycle

---

## References

- **Slack Channel Management**: [./slack-channel-management.md](./slack-channel-management.md) - Channel Access Rules engine
- **Vercel Workflows**: https://vercel.com/docs/workflow - Workflow orchestration
- **Stripe Subscriptions**: https://stripe.com/docs/billing/subscriptions/pause - Pause/resume API
