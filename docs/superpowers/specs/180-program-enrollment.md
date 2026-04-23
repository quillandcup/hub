# 180 Program Enrollment

**Date:** 2026-04-22  
**Status:** Future - Not MVP  
**Dependencies:**
- [Member Identity Management](./member-identity-management.md)
- [Hiatus Management](./hiatus-management.md)
- [Slack Channel Management](./slack-channel-management.md)

---

## Overview

### Problem Statement

The 180 Program is a focused 6-month writing program that overlaps with regular Q&C membership:
- **Manual enrollment**: Admin manually enrolls members in Kajabi, pauses subscriptions, calculates refunds
- **Manual refunds**: Admin calculates prorated refunds for membership overlap and issues manually via Stripe
- **Manual channel access**: Admin manually adds members to 180 Program Slack channels (both generic and cohort-specific)
- **Manual membership extension**: Admin manually tracks that membership resumes after 6 months

### Solution

**Automated 180 Program enrollment workflow:**
- Calculate prorated refund for monthly membership overlap
- Issue refund via Stripe API
- Grant 180 Program product access with cohort tracking
- Extend Q&C Membership for 6 months (free)
- Pause monthly subscription for 6 months
- Grant Slack channel access (generic + cohort-specific channels)
- Send confirmation email with refund amount and resume date

---

## Cohort System

### Cohort Identification

**Format**: `YYYY-MM` (e.g., `2026-01` for January 2026 cohort)

**Auto-detection**: If cohort not specified during enrollment, generate from enrollment date:
```typescript
function generateCohortId(enrollmentDate: Date): string {
  const year = enrollmentDate.getFullYear();
  const month = (enrollmentDate.getMonth() + 1).toString().padStart(2, '0');
  return `${year}-${month}`;
}
```

### Cohort-Specific Resources

Each cohort gets:
- **Generic 180 channels**: `#180-general`, `#180-resources` (all cohorts)
- **Cohort-specific channels**: `#180-jan-2026`, `#180-jan-2026-accountability` (via Channel Access Rules)
- **Product access record** with `cohort` field for tracking

---

## Data Model

### Silver Layer: `member_product_access`

Tracks member access to products/programs (already exists, but add cohort support).

```sql
CREATE TABLE member_product_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kajabi_product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  kajabi_offer_id TEXT,
  cohort TEXT, -- Cohort identifier (e.g., "2026-01")
  access_granted_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  access_expires_at TIMESTAMP WITH TIME ZONE,
  source TEXT NOT NULL CHECK (source IN ('purchase', 'gift', 'trial', 'bundle')),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Unique constraint allows same product multiple times if different cohorts
CREATE UNIQUE INDEX idx_product_access_unique 
  ON member_product_access(member_id, kajabi_product_id, COALESCE(cohort, ''));

CREATE INDEX idx_product_access_cohort ON member_product_access(kajabi_product_id, cohort);

COMMENT ON COLUMN member_product_access.cohort IS 'Cohort identifier for programs that run multiple times (e.g., "2026-01" for Jan 2026 180 Program)';
```

---

## Enrollment Workflow

### Workflow: `enroll180ProgramWorkflow`

**Trigger**: `POST /admin/programs/180/enroll`

**Input**:
```typescript
{
  memberId: string;
  enrollmentDate: string; // YYYY-MM-DD
  cohort?: string; // Optional, auto-detected if not provided
}
```

**Steps**:

1. **Auto-detect cohort** (if not provided)
   - Generate from enrollment date: `YYYY-MM`

2. **Calculate prorated refund**
   - Find member's monthly subscription
   - Get next billing date from Stripe
   - Calculate days overlap between enrollment date and next billing date
   - Daily rate: $1.55/day (based on $46.50/30 days)
   - Refund amount = days_overlap * $1.55

3. **Issue refund in Stripe** (if applicable)
   - Get latest paid invoice for member's Stripe customer
   - Create refund via `stripe.refunds.create()`
   - Metadata: reason for refund ("180 membership overlap")

4. **Grant 180 Program product access**
   - Insert into `member_product_access`
   - `product_name = "180 Program"`
   - `cohort = {detected cohort}`
   - `source = "purchase"`

5. **Extend Q&C Membership for 6 months**
   - Insert into `member_product_access`
   - `product_name = "Q&C Membership"`
   - `access_expires_at = enrollmentDate + 6 months`

6. **Pause monthly subscription for 6 months**
   - Find member's Stripe subscription
   - Call `stripe.subscriptions.update({ pause_collection: { behavior: 'void', resumes_at } })`
   - Update `member_subscriptions.pause_resumes_at`

7. **Grant Slack channel access** (via [Slack Channel Management](./slack-channel-management.md))
   - Trigger: `program_join` with `{ program: "180 Program", cohort }`
   - Rules engine evaluates:
     - Generic rule: grants `#180-general`, `#180-resources` (all cohorts)
     - Cohort-specific rule: grants `#180-jan-2026`, `#180-jan-2026-accountability`

8. **Send confirmation email**
   - Template: "180 Program enrollment confirmed!"
   - Include: cohort, resume date, refund amount (if any)

**Output**:
```typescript
{
  success: true,
  cohort: string,
  refundIssued: number, // USD
  membershipResumeDate: string,
  channelsGranted: string[]
}
```

---

## Prorated Refund Calculation

### Algorithm

**Context**: Member enrolls in 180 Program mid-billing cycle. They've already paid for the full month, but won't need membership during the 180 Program (6 months). Refund the unused days.

**Formula**:
```typescript
async function calculateProratedRefund(memberId: string, enrollmentDate: Date): Promise<number> {
  // 1. Get member's monthly subscription
  const subscription = await getMonthlySubscription(memberId);
  if (!subscription) return 0;
  
  // 2. Get next billing date
  const nextBillingDate = subscription.current_period_end;
  
  // 3. Calculate days overlap
  const daysOverlap = Math.ceil(
    (nextBillingDate.getTime() - enrollmentDate.getTime()) / (1000 * 60 * 60 * 24)
  );
  
  if (daysOverlap <= 0) return 0; // Already billed for future period
  
  // 4. Calculate refund
  const dailyRate = 1.55; // $46.50 / 30 days
  return Math.round(daysOverlap * dailyRate * 100) / 100; // Round to cents
}
```

**Example**:
- Enrollment date: Jan 15
- Next billing date: Jan 31
- Days overlap: 16 days
- Refund: 16 * $1.55 = $24.80

---

## Channel Access Rules

### Generic 180 Program Channels (all cohorts)

```sql
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'program_join',
  '{"program": "180 Program"}',
  ARRAY['180-general', '180-resources'],
  'grant',
  true
);
```

### Cohort-Specific Channels

Create one rule per cohort:

```sql
-- January 2026 cohort
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'program_join',
  '{"program": "180 Program", "cohort": "2026-01"}',
  ARRAY['180-jan-2026', '180-jan-2026-accountability'],
  'grant',
  true
);

-- February 2026 cohort
INSERT INTO channel_access_rules (trigger_type, trigger_value, channels, action, active)
VALUES (
  'program_join',
  '{"program": "180 Program", "cohort": "2026-02"}',
  ARRAY['180-feb-2026', '180-feb-2026-accountability'],
  'grant',
  true
);
```

---

## API Routes

### POST /admin/programs/180/enroll

**Access**: Admin only

**Request Body**:
```typescript
{
  memberId: string;
  enrollmentDate: string; // YYYY-MM-DD
  cohort?: string; // Optional
}
```

**Response**:
```typescript
{
  success: boolean;
  cohort: string;
  refundIssued: number;
  membershipResumeDate: string;
  channelsGranted: string[];
}
```

**Implementation**:
```typescript
import { start } from "workflow/api";
import { enroll180ProgramWorkflow } from "@/workflows/programs/enroll-180";

export async function POST(request: NextRequest) {
  const { memberId, enrollmentDate, cohort } = await request.json();
  
  const result = await start(enroll180ProgramWorkflow, {
    memberId,
    enrollmentDate: new Date(enrollmentDate),
    cohort
  });
  
  return NextResponse.json(result);
}
```

---

## Admin UI

### 180 Program Enrollment Page

**Location**: `/admin/programs/180/enroll`

**Features**:

1. **Member Selection**
   - Search bar: "Search members..."
   - Autocomplete dropdown showing member name + email

2. **Enrollment Form**
   - Date picker: Enrollment Date (defaults to today)
   - Text input: Cohort (optional, auto-detected if blank)
   - Preview section:
     - "Next billing date: Jan 31"
     - "Days overlap: 16"
     - "Refund amount: $24.80"
     - "Membership resumes: Jul 15, 2026"

3. **Confirm Button**
   - "Enroll in 180 Program"
   - Shows loading spinner during workflow

4. **Success Message**
   - "✅ {Member Name} enrolled in 180 Program ({cohort})"
   - "Refund issued: ${amount}"
   - "Channels granted: {list}"

### Member Detail Page Enhancement

**Location**: `/admin/members/:id`

**Add section**: "Program Enrollments"

**Displays**:
- Table of all product access records
- Columns: Product Name, Cohort, Granted At, Expires At, Source
- Highlight 180 Program rows

---

## Testing Requirements

### Prorated Refund Tests

```typescript
describe('calculateProratedRefund', () => {
  it('should calculate refund for mid-cycle enrollment', () => {
    // Enrollment: Jan 15
    // Next billing: Jan 31
    // Expected: 16 * $1.55 = $24.80
  });
  
  it('should return 0 if enrolled on billing date', () => {
    // Enrollment: Jan 31
    // Next billing: Jan 31
    // Expected: $0
  });
  
  it('should return 0 if no active subscription', () => {
    // Member has no subscription
    // Expected: $0
  });
});
```

### Workflow Tests

```typescript
describe('enroll180ProgramWorkflow', () => {
  it('should enroll member with auto-detected cohort', () => {
    // Enrollment: Jan 15, 2026
    // Cohort should be: "2026-01"
  });
  
  it('should issue Stripe refund', () => {
    // Mock stripe.refunds.create
    // Verify called with correct amount
  });
  
  it('should pause subscription for 6 months', () => {
    // Mock stripe.subscriptions.update
    // Verify pause_collection.resumes_at = +6 months
  });
  
  it('should grant generic + cohort channels', () => {
    // Verify channels: ['180-general', '180-resources', '180-jan-2026', '180-jan-2026-accountability']
  });
});
```

---

## Success Criteria

1. **Automation**:
   - [ ] Admin can enroll member via UI (no Stripe dashboard or Kajabi access needed)
   - [ ] Refund calculated and issued automatically
   - [ ] Subscription paused for 6 months automatically
   - [ ] Slack channels granted automatically (generic + cohort)

2. **Data Integrity**:
   - [ ] Product access record includes cohort
   - [ ] Membership resume date tracked in `member_subscriptions`
   - [ ] Refund amount logged in Stripe metadata

3. **User Experience**:
   - [ ] Confirmation email sent with all details
   - [ ] Admin UI shows preview before enrolling
   - [ ] Member sees 180 Program in their dashboard

---

## Future Enhancements

1. **Self-Service Enrollment**: Members enroll themselves via payment link
2. **Waitlist**: Cohorts have max capacity, members can join waitlist
3. **Cohort Analytics**: Track completion rates, engagement by cohort
4. **Graduation Workflow**: Auto-grant "180 Program Graduate" role after 6 months
5. **Alumni Channel**: Grant access to alumni channel after program completion

---

## References

- **Hiatus Management**: [./hiatus-management.md](./hiatus-management.md) - Subscription pause/resume workflow
- **Slack Channel Management**: [./slack-channel-management.md](./slack-channel-management.md) - Channel Access Rules for cohort channels
- **Stripe Refunds API**: https://stripe.com/docs/api/refunds
