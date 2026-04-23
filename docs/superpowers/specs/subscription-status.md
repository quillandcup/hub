# Subscription Status

**Date:** 2026-04-22  
**Status:** Draft  
**Dependencies:** [Member Identity Management](./member-identity-management.md)  
**Blocks:** None

---

## Overview

### Problem Statement

Subscription status is scattered across multiple systems:
- **Stripe dashboard**: Admins must switch to Stripe to check billing status
- **No member visibility**: Members can't see their subscription status, billing history, or next charge date
- **Manual tracking**: No centralized view of paused subscriptions, trials, or cancellations

### Solution

**Subscription status visibility:**
- Sync Stripe subscription data to local database (Bronze/Silver layers)
- Admin views: subscription status on member detail pages, dashboard widgets
- Member views: personal subscription status, billing history, next charge date
- Real-time sync via Stripe webhooks + daily reconciliation

---

## Data Model

### Bronze Layer: Stripe Raw Data

```sql
CREATE TABLE bronze.stripe_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_subscription_id TEXT UNIQUE NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active', 'paused', 'canceled', 'trialing', 'past_due', 'unpaid'
  current_period_start TIMESTAMP WITH TIME ZONE,
  current_period_end TIMESTAMP WITH TIME ZONE,
  billing_cycle_anchor TIMESTAMP WITH TIME ZONE,
  pause_collection JSONB, -- {behavior: 'void', resumes_at: timestamp}
  cancel_at TIMESTAMP WITH TIME ZONE,
  canceled_at TIMESTAMP WITH TIME ZONE,
  trial_start TIMESTAMP WITH TIME ZONE,
  trial_end TIMESTAMP WITH TIME ZONE,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL, -- Full Stripe subscription object
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_stripe_subs_customer ON bronze.stripe_subscriptions(stripe_customer_id);
CREATE INDEX idx_stripe_subs_status ON bronze.stripe_subscriptions(status);
CREATE INDEX idx_stripe_subs_updated_at ON bronze.stripe_subscriptions(updated_at);

COMMENT ON TABLE bronze.stripe_subscriptions IS 'BRONZE: UPSERT by stripe_subscription_id';
```

### Silver Layer: Member Subscriptions

```sql
CREATE TABLE member_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  product_name TEXT NOT NULL, -- 'Monthly Membership', '180 Program', etc.
  kajabi_offer_id TEXT,
  pause_resumes_at TIMESTAMP WITH TIME ZONE, -- Set by hiatus workflow
  workflow_run_id TEXT, -- Vercel Workflow that paused/modified subscription
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_member_subs_member ON member_subscriptions(member_id);
CREATE INDEX idx_member_subs_stripe ON member_subscriptions(stripe_subscription_id);
CREATE INDEX idx_member_subs_resume ON member_subscriptions(pause_resumes_at) WHERE pause_resumes_at IS NOT NULL;

COMMENT ON TABLE member_subscriptions IS 'SILVER: Links members to bronze.stripe_subscriptions';
COMMENT ON COLUMN member_subscriptions.pause_resumes_at IS 'Auto-resume date set by hiatus workflow (may differ from Stripe pause_collection.resumes_at)';
```

---

## Data Sync

### Stripe Webhook Handler

**Route**: `POST /api/webhooks/stripe`

**Purpose**: Receives Stripe webhook events, syncs to Bronze layer

**Events Handled**:
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.paused`
- `customer.subscription.deleted`
- `customer.subscription.resumed`
- `customer.subscription.trial_will_end` (3 days before trial ends)

**Implementation**:

```typescript
// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = headers().get("stripe-signature");
  
  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }
  
  let event: Stripe.Event;
  
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error(`Webhook signature verification failed: ${err.message}`);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  
  const supabase = await createClient();
  
  switch (event.type) {
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.paused':
    case 'customer.subscription.deleted':
    case 'customer.subscription.resumed':
      await syncStripeSubscription(event.data.object as Stripe.Subscription, supabase);
      break;
      
    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
  
  return NextResponse.json({ received: true });
}
```

**Sync Logic** (shared with reconciliation):

```typescript
// lib/sync/stripe-subscription.ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) {
  await supabase
    .from("bronze.stripe_subscriptions")
    .upsert({
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer as string,
      status: subscription.status,
      current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
      current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
      billing_cycle_anchor: new Date(subscription.billing_cycle_anchor * 1000).toISOString(),
      pause_collection: subscription.pause_collection || null,
      cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
      canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
      trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      imported_at: new Date().toISOString(),
      data: subscription
    }, {
      onConflict: 'stripe_subscription_id'
    });
}
```

### Daily Reconciliation

**Route**: `GET /api/cron/reconcile-stripe`

**Schedule**: Daily at 2am

**Purpose**: Catch missed webhooks, ensure Bronze layer matches Stripe

**Logic**:
1. Fetch all `member_subscriptions.stripe_subscription_id`
2. For each, fetch from Stripe API: `stripe.subscriptions.retrieve()`
3. Sync to Bronze layer via `syncStripeSubscription()`

```typescript
// app/api/cron/reconcile-stripe/route.ts
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const supabase = await createClient();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
  
  const { data: memberSubs } = await supabase
    .from("member_subscriptions")
    .select("stripe_subscription_id");
    
  if (!memberSubs) {
    return NextResponse.json({ success: true, reconciled: 0 });
  }
  
  for (const sub of memberSubs) {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    await syncStripeSubscription(stripeSub, supabase);
  }
  
  return NextResponse.json({ 
    success: true, 
    reconciled: memberSubs.length 
  });
}
```

---

## Admin UI

### Member Detail Page: Subscription Status

**Location**: `/admin/members/:id`

**Section**: "Subscription"

**Display**:

```typescript
interface SubscriptionDisplay {
  status: 'active' | 'paused' | 'canceled' | 'trialing' | 'past_due';
  statusBadge: React.ReactNode; // Color-coded badge
  nextChargeDate?: string;
  pausedUntil?: string;
  trialEndsAt?: string;
  canceledAt?: string;
  productName: string;
}
```

**Example Displays**:

- **Active**: "✅ Active - renews Feb 1, 2026 ($46.50)"
- **Paused**: "⏸️ Paused - resumes Jul 15, 2026"
- **Trial**: "🎁 Trial - ends Jan 31, 2026"
- **Canceled**: "❌ Canceled on Dec 15, 2025"
- **Past Due**: "⚠️ Past Due - payment failed"

**Actions** (buttons):
- "View in Stripe" → opens Stripe dashboard
- "Pause Subscription" → triggers hiatus workflow (only if active)
- "Resume Subscription" → triggers end hiatus workflow (only if paused)

### Dashboard Widget: Subscription Overview

**Location**: `/admin/members` or `/admin` (main dashboard)

**Metrics**:

```
┌─ Subscription Status ─────────┐
│ 95 Active ($4,467/mo MRR)     │
│ 8 Paused (hiatus)             │
│ 12 Trials (3 ending soon)     │
│ 4 Past Due ⚠️                  │
│                                │
│ [View All →]                  │
└────────────────────────────────┘
```

**Query**:

```sql
SELECT 
  status,
  COUNT(*) as count,
  SUM(CASE WHEN status = 'active' THEN price_in_cents / 100 ELSE 0 END) as mrr
FROM bronze.stripe_subscriptions ss
JOIN member_subscriptions ms ON ss.stripe_subscription_id = ms.stripe_subscription_id
GROUP BY status;
```

### Filtered Member Lists

**Location**: `/admin/members?filter=subscription_status`

**Filters**:
- All Members
- Active Subscriptions
- Paused (Hiatus)
- Trials
- Past Due (Payment Issues)
- Canceled

---

## Member UI

### Personal Subscription Page

**Location**: `/subscription` (member-facing)

**Sections**:

1. **Current Status Card**
   ```
   ┌─ Your Subscription ────────────────┐
   │ Status: Active ✅                   │
   │ Plan: Monthly Membership ($46.50)  │
   │ Next charge: Feb 1, 2026           │
   │                                     │
   │ [Manage Billing in Stripe →]      │
   └─────────────────────────────────────┘
   ```

2. **Billing History Table**
   - Date, Amount, Status, Receipt Link
   - Fetched from Stripe invoices API

3. **Actions**
   - "Update Payment Method" → redirects to Stripe Customer Portal
   - "Download Receipts" → list of invoice PDFs
   - "Request Hiatus" → opens hiatus request form (if feature enabled)

**API Route**: `GET /api/member/subscription`

```typescript
// app/api/member/subscription/route.ts
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  
  // Get authenticated member
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Find member by email
  const { data: member } = await supabase
    .from("members")
    .select("id, stripe_customer_id")
    .eq("email", user.email)
    .single();
    
  if (!member) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }
  
  // Get subscription status
  const { data: subscription } = await supabase
    .from("member_subscriptions")
    .select(`
      *,
      stripe_subscription:bronze.stripe_subscriptions(*)
    `)
    .eq("member_id", member.id)
    .single();
    
  return NextResponse.json({
    status: subscription?.stripe_subscription?.status || 'none',
    productName: subscription?.product_name,
    nextChargeDate: subscription?.stripe_subscription?.current_period_end,
    pausedUntil: subscription?.pause_resumes_at,
    stripeCustomerId: member.stripe_customer_id
  });
}
```

---

## Testing Requirements

### Webhook Tests

```typescript
describe('POST /api/webhooks/stripe', () => {
  it('should sync subscription on subscription.created', async () => {
    const event = createStripeEvent({
      type: 'customer.subscription.created',
      data: { object: mockSubscription }
    });
    
    await POST('/api/webhooks/stripe', event);
    
    const { data } = await supabase
      .from('bronze.stripe_subscriptions')
      .select('*')
      .eq('stripe_subscription_id', mockSubscription.id)
      .single();
    
    expect(data.status).toBe('active');
  });
  
  it('should reject invalid signature', async () => {
    const response = await POST('/api/webhooks/stripe', {
      headers: { 'stripe-signature': 'invalid' }
    });
    
    expect(response.status).toBe(400);
  });
});
```

### Reconciliation Tests

```typescript
describe('GET /api/cron/reconcile-stripe', () => {
  it('should sync all subscriptions from Stripe', async () => {
    // Mock Stripe API responses
    const stripeMock = mockStripeSubscriptions([...]);
    
    await GET('/api/cron/reconcile-stripe');
    
    // Verify all synced to Bronze
    const { data } = await supabase
      .from('bronze.stripe_subscriptions')
      .select('count');
    
    expect(data.count).toBe(stripeMock.length);
  });
});
```

---

## Deployment

### Environment Variables

```bash
# Stripe API keys
vercel env add STRIPE_SECRET_KEY production
vercel env add STRIPE_WEBHOOK_SECRET production

# Cron authentication
vercel env add CRON_SECRET production
```

### Stripe Webhook Setup

1. **Stripe Dashboard** → Developers → Webhooks
2. **Add endpoint**: `https://your-domain.vercel.app/api/webhooks/stripe`
3. **Select events**:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.paused`
   - `customer.subscription.deleted`
   - `customer.subscription.resumed`
   - `customer.subscription.trial_will_end`
4. **Copy webhook signing secret** → `STRIPE_WEBHOOK_SECRET`

### Vercel Cron Configuration

```json
{
  "crons": [
    {
      "path": "/api/cron/reconcile-stripe",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## Success Criteria

1. **Data Sync**:
   - [ ] Stripe webhooks sync subscriptions to Bronze layer in real-time
   - [ ] Daily reconciliation catches missed webhooks
   - [ ] Bronze layer matches Stripe state

2. **Admin Visibility**:
   - [ ] Member detail page shows current subscription status
   - [ ] Dashboard widget shows subscription breakdown
   - [ ] Can filter members by subscription status

3. **Member Visibility**:
   - [ ] Members can view their subscription status
   - [ ] Members can see next charge date
   - [ ] Members can access billing history

4. **Integration**:
   - [ ] Hiatus workflow updates `pause_resumes_at` correctly
   - [ ] 180 Program workflow pauses subscriptions correctly

---

## Future Enhancements

1. **Revenue Analytics**:
   - MRR (Monthly Recurring Revenue) trend chart
   - Churn rate by month
   - Trial conversion rate tracking

2. **Payment Issue Alerts**:
   - Email admins when payment fails (`invoice.payment_failed`)
   - Auto-send dunning emails to members

3. **Subscription Changes**:
   - Self-service plan upgrades (monthly → annual)
   - Add-on purchases (extra seats, premium features)

4. **Billing Insights**:
   - Revenue by product (Monthly vs 180 Program)
   - Customer Lifetime Value (CLV)
   - Cohort revenue retention

---

## References

- **Hiatus Management**: [./hiatus-management.md](./hiatus-management.md) - Uses `member_subscriptions.pause_resumes_at`
- **180 Program Enrollment**: [./180-program-enrollment.md](./180-program-enrollment.md) - Pauses subscriptions for 6 months
- **Stripe Webhooks**: https://stripe.com/docs/webhooks
- **Stripe Subscriptions API**: https://stripe.com/docs/api/subscriptions
