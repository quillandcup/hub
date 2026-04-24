# Architecture Foundation - Quill & Cup Operations Platform

**Date:** 2026-04-21  
**Status:** Reference Architecture  
**Scope:** Cross-cutting architectural decisions for all platform features

---

## Overview

This document establishes the architectural patterns and principles for the Quill & Cup Operations Platform. All feature specs should follow these patterns unless there's a documented reason to deviate.

**Platform Purpose:** Comprehensive system to run Quill & Cup business operations for both admins and members - automating manual SOPs, providing engagement insights, enabling self-service features.

**Design Goals:**
- **Reliable:** Webhooks + reconciliation catch missed events
- **Reprocessable:** Can rebuild derived data from raw sources
- **Testable:** Local-first development with fast feedback loops
- **Observable:** Clear audit trails and workflow visibility
- **Maintainable:** Separation of concerns across data layers

---

## Medallion Architecture

Data flows through distinct layers, each with specific responsibilities:

```
External APIs (Kajabi, Stripe, Zoom, Google Calendar, Slack)
          ↓
    Bronze Layer (raw imports, append-only or UPSERT)
          ↓
    Local Layer (operational data we own)
          ↓
    Silver Layer (derived/canonical, reprocessable)
          ↓
    Gold Layer (aggregations, views)
          ↓
    Application (dashboards, workflows, APIs)
```

### Bronze Layer

**Purpose:** Raw, unprocessed data from external systems

**Characteristics:**
- Stored in `bronze` PostgreSQL schema (hidden from Supabase API)
- **UPSERT by natural key** (consistent pattern for all tables)
- Full JSON payload preserved in `data` column
- Idempotent imports (re-running same import is safe)
- `updated_at` timestamp tracks last sync

**Tables:**
- `bronze.kajabi_members` (UPSERT by kajabi_contact_id)
- `bronze.kajabi_products` (UPSERT by kajabi_product_id)
- `bronze.kajabi_offers` (UPSERT by kajabi_offer_id)
- `bronze.stripe_subscriptions` (UPSERT by stripe_subscription_id)
- `bronze.zoom_meetings` (UPSERT by meeting_uuid)
- `bronze.zoom_attendees` (UPSERT by meeting_uuid + participant_id)
- `bronze.calendar_events` (UPSERT by google_event_id)

**Pattern (consistent across all Bronze tables):**
```sql
-- All Bronze tables use UPSERT by natural key
INSERT INTO bronze.kajabi_members (kajabi_contact_id, email, data, ...)
VALUES ('contact_123', 'user@example.com', '{"id": "contact_123", ...}', ...)
ON CONFLICT (kajabi_contact_id) DO UPDATE
  SET email = EXCLUDED.email,
      data = EXCLUDED.data,
      imported_at = EXCLUDED.imported_at,
      updated_at = now();
```

**Why UPSERT everywhere:**
- Simple, consistent pattern across all Bronze tables
- Idempotent by definition (re-import same data = update timestamp, no duplicates)
- `updated_at` tracks when data last changed
- No complex "latest snapshot" logic needed

### Local Layer

**Purpose:** Operational data owned by this application (not derived from external systems)

**Characteristics:**
- Stored in `public` schema with `LOCAL` comment
- Normal CRUD operations (INSERT, UPDATE, DELETE)
- **NOT reprocessable** - these are the source of truth
- Includes configuration, manual overrides, business rules

**Tables:**
- `member_email_aliases` (track email changes across systems)
- `member_hiatus_history` (hiatus tracking)
- `member_name_aliases` (manual name corrections)
- `ignored_zoom_names` (exclude bots/test users)
- `prickle_types` (prickle categorization)
- `staff` (staff roster)
- `channel_access_rules` (Slack channel rules)

**Pattern:**
```sql
-- Normal CRUD - this is our data
INSERT INTO member_email_aliases (member_id, email, source)
VALUES ('uuid', 'new@example.com', 'manual');

UPDATE member_hiatus_history
SET end_date = '2026-05-01'
WHERE id = 'uuid';

DELETE FROM ignored_zoom_names WHERE zoom_name = 'Test User';
```

### Silver Layer

**Purpose:** Canonical, derived state computed from Bronze + Local sources

**Characteristics:**
- Stored in `public` schema with `SILVER` comment
- **Reprocessable** - can be rebuilt from Bronze + Local at any time
- Processing logic is deterministic
- Pattern choice depends on entity type (see below)

**Tables:**
- `members` (canonical member list from Kajabi + aliases) - **Identity Entity**
- `member_product_access` (product access from Kajabi purchases) - Event Entity
- `member_subscriptions` (links members to Stripe subscriptions) - Event Entity
- `member_slack_channels` (current Slack channel access) - Event Entity
- `prickles` (canonical events from calendar + zoom) - Event Entity
- `prickle_attendance` (prickle attendance records from zoom data) - Event Entity

#### Identity Entities vs Event Entities

Silver tables fall into two categories with different reprocessing patterns:

**Identity Entities** - Stable identities with relationships (use UPSERT):
- Entities: `members`, `products`, `channels`
- Pattern: **UPSERT by stable identifier** (email, external ID)
- Why: Must preserve UUIDs to maintain foreign key relationships
- Scope: Full table reprocessing

```sql
-- CORRECT: UPSERT by stable identifier (preserves UUIDs and relationships)
INSERT INTO members (email, name, joined_at, status, ...)
SELECT email, name, joined_at, status, ...
FROM bronze.kajabi_members
WHERE ...
ON CONFLICT (email) DO UPDATE SET
  name = EXCLUDED.name,
  status = EXCLUDED.status,
  updated_at = NOW();

-- Why: Same email → same UUID → aliases, prickles, attendance stay linked
```

**Event Entities** - Time-scoped events and relationships (use DELETE + INSERT):
- Entities: `prickles`, `prickle_attendance`, `member_product_access`, `member_slack_channels`
- Pattern: **DELETE + INSERT by scope** (date range, status)
- Why: Must remove orphans when source data is deleted
- Scope: Date range or other logical scope

```sql
-- CORRECT: DELETE + INSERT (orphans are removed)
DELETE FROM prickles
WHERE start_time >= '2026-04-01' AND start_time < '2026-05-01'
  AND source = 'calendar';

INSERT INTO prickles (type_id, title, host, start_time, end_time, source)
SELECT ... FROM bronze.calendar_events
WHERE start_time >= '2026-04-01' AND start_time < '2026-05-01';

-- WRONG: UPSERT (leaves orphaned data)
INSERT INTO prickles (...) VALUES (...)
ON CONFLICT (id) DO UPDATE ...;  -- ❌ Deleted events stay forever
```

**Why the distinction:**
- **Identity entities** have stable external identifiers (email) and must preserve internal UUIDs across reprocessing to maintain relationships (aliases, attendance)
- **Event entities** are scoped by time/status and should be fully recomputed for each scope - deleted events must be removed from Silver
- Both patterns achieve reprocessability but optimize for different data characteristics

### Gold Layer

**Purpose:** Aggregations and views for dashboards

**Characteristics:**
- PostgreSQL views (not tables)
- Computed on-demand from Silver layer
- No storage, just query logic
- Can be materialized if performance requires

**Example:**
```sql
CREATE VIEW member_engagement_weekly AS
SELECT 
  member_id,
  date_trunc('week', prickle_date) as week,
  count(DISTINCT prickle_id) as prickles_attended,
  sum(duration_minutes) as total_minutes
FROM attendance
GROUP BY member_id, date_trunc('week', prickle_date);
```

---

## Schema Organization

### PostgreSQL Schemas

**`bronze` schema:**
- Hidden from Supabase API (no auto-generated APIs)
- Accessed via server-side code only
- Grants: `postgres`, `anon`, `authenticated`, `service_role`

**`public` schema:**
- Exposed via Supabase API
- Contains Local + Silver + Gold
- Uses table comments to mark layer:
  - `COMMENT ON TABLE members IS 'SILVER: Reprocessable from bronze.kajabi_members';`
  - `COMMENT ON TABLE staff IS 'LOCAL: Operational data - do not DELETE';`

**Why this split:**
- Supabase has issues with non-public schemas in API generation
- Bronze should never be exposed directly to frontend
- RLS policies apply to public schema only

### Table Naming Conventions

- Bronze: `bronze.{system}_{entity}` (e.g., `bronze.kajabi_members`)
- Local/Silver: Descriptive names without prefix (e.g., `members`, `prickles`)
- Use comments to mark layer, not prefixes

---

## Reprocessability Principles

### What is Reprocessability?

The ability to delete and recreate Silver layer data from Bronze + Local sources without data loss.

### Why It Matters

- **Deleted source data** must be removed from Silver layer
- **Changed business logic** can be re-applied to historical data
- **Data corrections** in Bronze propagate to Silver
- **Recovery** from bugs in processing logic

### Requirements for Silver Tables

**For Identity Entities** (members, products, channels):
1. **UPSERT by stable identifier** (email, external ID) in processing routes
2. **Full table scope** (process all entities each time)
3. **Preserve UUIDs** (same identifier → same UUID across reprocessing)
4. **Deterministic logic** (same inputs → same outputs)
5. **No manual edits** (all changes via reprocessing)

**For Event Entities** (prickles, attendance, access):
1. **DELETE + INSERT pattern** in processing routes
2. **Scoped deletion** (by date range or other criteria, not full table)
3. **Remove orphans** (deleted source data → deleted Silver data)
4. **Deterministic logic** (same inputs → same outputs)
5. **No manual edits** (all changes via reprocessing)

### Testing Reprocessability

**Test location:** `tests/api/reprocessability/`

**For Identity Entities** - must verify UUID stability:
```typescript
test('members reprocessing preserves UUIDs and relationships', async () => {
  // 1. Process members → creates members
  await POST('/api/process/members');
  const { data: memberBefore } = await supabase
    .from('members')
    .select('id, email')
    .eq('email', 'user@example.com')
    .single();
  
  // 2. Create an alias for this member
  await supabase.from('member_name_aliases')
    .insert({ member_id: memberBefore.id, alias: 'User' });
  
  // 3. Reprocess members (new Bronze data, same email)
  await POST('/api/process/members');
  const { data: memberAfter } = await supabase
    .from('members')
    .select('id, email')
    .eq('email', 'user@example.com')
    .single();
  
  // 4. Verify UUID unchanged (relationships preserved)
  expect(memberAfter.id).toBe(memberBefore.id);
  
  // 5. Verify alias still exists (not CASCADE deleted)
  const { data: alias } = await supabase
    .from('member_name_aliases')
    .select('*')
    .eq('member_id', memberBefore.id)
    .single();
  expect(alias).toBeTruthy();
});
```

**For Event Entities** - must verify orphan removal:
```typescript
test('prickles reprocessing removes deleted events', async () => {
  // 1. Process calendar events → creates prickles
  await POST('/api/process/calendar', { fromDate, toDate });
  const { count: before } = await supabase
    .from('prickles').select('*', { count: 'exact' });
  
  // 2. Delete a calendar event from bronze
  await supabase.from('bronze.calendar_events')
    .delete().eq('google_event_id', 'deleted-event');
  
  // 3. Reprocess same date range
  await POST('/api/process/calendar', { fromDate, toDate });
  const { count: after } = await supabase
    .from('prickles').select('*', { count: 'exact' });
  
  // 4. Verify orphan was removed
  expect(after).toBeLessThan(before);
  const { data: orphan } = await supabase
    .from('prickles')
    .select('*')
    .eq('google_event_id', 'deleted-event')
    .single();
  expect(orphan).toBeNull();
});
```

---

## Idempotency Principles

### What is Idempotency?

Running the same operation multiple times produces the same result as running it once.

### Why It Matters

- **Webhook retries** may send duplicate events
- **Reconciliation** re-imports data that webhooks already handled
- **Manual re-runs** should be safe (no duplicates)

### Bronze Layer Idempotency

**All Bronze tables use UPSERT by natural key:**
- Re-importing same data updates `updated_at` timestamp
- No duplicate rows created
- Idempotent by definition

**Example:**
```typescript
// First import
await supabase.from("bronze.kajabi_members").upsert({
  kajabi_contact_id: "contact_123",
  email: "user@example.com",
  data: { name: "John Doe", ... }
}, { onConflict: 'kajabi_contact_id' });

// Re-import (same data) - updates updated_at, no duplicate
await supabase.from("bronze.kajabi_members").upsert({
  kajabi_contact_id: "contact_123",
  email: "user@example.com",
  data: { name: "John Doe", ... }
}, { onConflict: 'kajabi_contact_id' });

// Count = 1 (not 2)
```

### Testing Idempotency

Every Bronze import route must have tests verifying:
1. First import creates records
2. Re-importing same data does NOT create duplicates (UPSERT behavior)
3. Re-importing with changed data updates correctly (updates `data` and `updated_at`)

**Test location:** `tests/api/idempotency/`

**Example test:**
```typescript
test('bronze import is idempotent', async () => {
  const memberData = {
    kajabi_contact_id: 'contact_123',
    email: 'test@example.com',
    data: { name: 'Original Name' }
  };
  
  // First import
  await supabase.from('bronze.kajabi_members')
    .upsert(memberData, { onConflict: 'kajabi_contact_id' });
  
  const { count: count1 } = await supabase
    .from('bronze.kajabi_members')
    .select('*', { count: 'exact' });
  
  // Re-import same data
  await supabase.from('bronze.kajabi_members')
    .upsert(memberData, { onConflict: 'kajabi_contact_id' });
  
  const { count: count2 } = await supabase
    .from('bronze.kajabi_members')
    .select('*', { count: 'exact' });
  
  // No duplicates
  expect(count2).toBe(count1);
  expect(count1).toBe(1);
  
  // Re-import with changed data
  const updatedData = { ...memberData, data: { name: 'New Name' } };
  await supabase.from('bronze.kajabi_members')
    .upsert(updatedData, { onConflict: 'kajabi_contact_id' });
  
  const { data: record } = await supabase
    .from('bronze.kajabi_members')
    .select('data')
    .eq('kajabi_contact_id', 'contact_123')
    .single();
  
  // Data updated
  expect(record.data.name).toBe('New Name');
});
```

---

## Webhooks + Reconciliation Strategy

### The Problem

Webhooks can fail, be delayed, or be missed. Relying solely on webhooks creates data gaps.

### The Solution

**Hybrid approach:**
- **Webhooks** for real-time updates (immediate Bronze UPSERT + Silver processing)
- **Daily reconciliation** for missed events (full refresh from API)

### Webhook Flow (Real-time Processing)

```
External system → Webhook → Bronze UPSERT → Silver processing → Workflow (if needed)
```

**Example:** Stripe subscription updated
1. Stripe sends `customer.subscription.updated` webhook
2. `/api/webhooks/stripe` receives event
3. Call `syncStripeSubscription()` to UPSERT `bronze.stripe_subscriptions`
4. **Immediately update Silver layer** (`member_subscriptions` table)
5. Trigger workflow if needed (e.g., hiatus end workflow if subscription resumed)

**Why process immediately:**
- Users see changes in real-time
- Workflows trigger instantly (e.g., send email when subscription pauses)
- Don't wait 24 hours for reconciliation to reflect changes

### Reconciliation Flow (Safety Net)

```
Daily cron → Fetch ALL data from API → Bronze UPSERT → Reprocess Silver
```

**Example:** Daily Stripe reconciliation
1. Cron job runs at 2am
2. Fetch **all** active subscriptions from Stripe API
3. UPSERT each to `bronze.stripe_subscriptions`
4. Reprocess entire Silver layer (DELETE + INSERT for date range)
5. Catches any webhooks that failed/were missed

**Why full reconciliation:**
- Fixes data drift (webhook failed but we didn't know)
- Catches deleted records (webhook never sent for deletions)
- Rebuilds Silver from current Bronze state (proves reprocessability)
- Self-healing: Production always converges to correct state within 24 hours

### Shared Sync Functions

To avoid duplication, webhooks and reconciliation use **shared sync functions**:

```typescript
// lib/sync/stripe-subscription.ts
export async function syncStripeSubscription(
  subscription: Stripe.Subscription,
  supabase: SupabaseClient
) {
  // 1. UPSERT to Bronze layer
  await supabase.from("bronze.stripe_subscriptions").upsert({
    stripe_subscription_id: subscription.id,
    stripe_customer_id: subscription.customer as string,
    status: subscription.status,
    // ... all fields
    data: subscription
  }, { onConflict: 'stripe_subscription_id' });
  
  // 2. Update Silver layer (member_subscriptions)
  await updateMemberSubscription(subscription, supabase);
}

// Used by webhook handler (real-time)
export async function POST(request: NextRequest) {
  const event = stripe.webhooks.constructEvent(...);
  await syncStripeSubscription(event.data.object, supabase);
  
  // Trigger workflows if needed
  if (event.type === 'customer.subscription.resumed') {
    await triggerHiatusEndWorkflow(event.data.object);
  }
}

// Used by reconciliation (batch)
export async function reconcileStripeSubscriptions() {
  const subscriptions = await stripe.subscriptions.list();
  for (const sub of subscriptions.data) {
    await syncStripeSubscription(sub, supabase);
  }
}
```

**Benefits:**
- Single source of truth for sync logic
- Webhooks provide real-time updates (Bronze + Silver)
- Reconciliation uses same logic (guarantees consistency)
- Easier to test (one function to test)
- Self-healing: Reconciliation fixes any missed webhooks

---

## Data Dependency Management

### The Problem

When data changes in Bronze or Local layers, we need to know:
1. **Which Silver tables are affected?** (downstream dependencies)
2. **In what order should we reprocess them?** (dependency ordering)
3. **Can we skip unaffected tables?** (incremental updates)

Without dependency tracking, we either:
- **Reprocess everything** (slow, wasteful)
- **Miss updates** (data becomes stale)
- **Process in wrong order** (prickle_attendance before members → broken references)

### Solution: Declarative Dependencies

**Define dependencies for each Silver table:**

```typescript
// lib/processing/dependencies.ts
export interface TableDependencies {
  bronze: string[];  // Bronze tables this depends on
  local: string[];   // Local tables this depends on
  silver: string[];  // Other Silver tables this depends on
  processingScope: 'full' | 'date-range';  // How to scope reprocessing
  dateField?: string;  // Required if processingScope = 'date-range'
}

export const SILVER_DEPENDENCIES: Record<string, TableDependencies> = {
  members: {
    bronze: ['kajabi_members'],
    local: ['member_email_aliases'],
    silver: [],
    processingScope: 'full'  // Entity state, no date scoping
  },
  
  member_product_access: {
    bronze: ['kajabi_products', 'kajabi_offers'],
    local: [],
    silver: ['members'],
    processingScope: 'date-range',
    dateField: 'access_granted_at'
  },
  
  member_subscriptions: {
    bronze: ['stripe_subscriptions'],
    local: [],
    silver: ['members'],
    processingScope: 'full'  // Current subscription state, no date scoping
  },
  
  prickles: {
    bronze: ['calendar_events', 'zoom_meetings'],
    local: ['prickle_types'],
    silver: [],
    processingScope: 'date-range',
    dateField: 'prickle_date'
  },
  
  prickle_attendance: {
    bronze: ['zoom_participants'],
    local: ['member_name_aliases', 'ignored_zoom_names'],
    silver: ['members', 'prickles'],  // Must process members and prickles first
    processingScope: 'date-range',
    dateField: 'prickle_date'
  },
  
  member_slack_channels: {
    bronze: [],
    local: ['channel_access_rules'],
    silver: ['members'],
    processingScope: 'full'  // Current access state, no date scoping
  }
};
```

### Computing Processing Order

**Use topological sort to determine correct order:**

```typescript
// lib/processing/order.ts
export function getProcessingOrder(
  tables: string[]
): string[] {
  const visited = new Set<string>();
  const order: string[] = [];
  
  function visit(table: string) {
    if (visited.has(table)) return;
    visited.add(table);
    
    const deps = SILVER_DEPENDENCIES[table];
    if (!deps) {
      throw new Error(`No dependencies defined for table: ${table}`);
    }
    
    // Visit Silver dependencies first (Bronze/Local are always available)
    for (const dep of deps.silver) {
      visit(dep);
    }
    
    order.push(table);
  }
  
  for (const table of tables) {
    visit(table);
  }
  
  return order;
}

// Example usage:
const order = getProcessingOrder(['prickle_attendance', 'prickles', 'members']);
// Returns: ['members', 'prickles', 'prickle_attendance']
```

### Finding Downstream Dependencies

**When Bronze/Local changes, find affected Silver tables:**

```typescript
// lib/processing/affected.ts
export function getAffectedSilverTables(
  changedTable: string,
  layer: 'bronze' | 'local'
): string[] {
  const affected: string[] = [];
  
  for (const [silverTable, deps] of Object.entries(SILVER_DEPENDENCIES)) {
    if (deps[layer].includes(changedTable)) {
      affected.push(silverTable);
    }
  }
  
  // Also include tables that depend on affected tables (transitive)
  const allAffected = new Set(affected);
  for (const table of affected) {
    const downstream = getDownstreamSilverTables(table);
    downstream.forEach(t => allAffected.add(t));
  }
  
  return Array.from(allAffected);
}

function getDownstreamSilverTables(silverTable: string): string[] {
  const downstream: string[] = [];
  
  for (const [table, deps] of Object.entries(SILVER_DEPENDENCIES)) {
    if (deps.silver.includes(silverTable)) {
      downstream.push(table);
      // Recursively find downstream of downstream
      const transitive = getDownstreamSilverTables(table);
      downstream.push(...transitive);
    }
  }
  
  return downstream;
}

// Example usage:
const affected = getAffectedSilverTables('calendar_events', 'bronze');
// Returns: ['prickles', 'prickle_attendance']

const ordered = getProcessingOrder(affected);
// Returns: ['prickles', 'prickle_attendance']
```

### Webhook Integration

**Webhooks trigger dependency-aware reprocessing:**

```typescript
// lib/processing/trigger.ts
export async function triggerReprocessing(
  changedTable: string,
  layer: 'bronze' | 'local',
  options?: { dateRange?: { from: Date; to: Date } }
) {
  // Find affected Silver tables
  const affected = getAffectedSilverTables(changedTable, layer);
  
  if (affected.length === 0) {
    console.log(`No Silver tables affected by ${layer}.${changedTable}`);
    return { processed: [] };
  }
  
  // Process in correct order
  const order = getProcessingOrder(affected);
  
  console.log(`Reprocessing ${order.join(' → ')} due to ${layer}.${changedTable} change`);
  
  const results = [];
  for (const table of order) {
    const result = await processTable(table, options);
    results.push({ table, ...result });
  }
  
  return { processed: results };
}

async function processTable(
  table: string,
  options?: { dateRange?: { from: Date; to: Date } }
) {
  const deps = SILVER_DEPENDENCIES[table];
  const route = `/api/process/${table.replace('_', '-')}`;
  
  // Determine scope based on table config
  let body: any = {};
  
  if (deps.processingScope === 'date-range') {
    if (!options?.dateRange) {
      throw new Error(`Table ${table} requires dateRange but none provided`);
    }
    body = {
      fromDate: options.dateRange.from.toISOString(),
      toDate: options.dateRange.to.toISOString()
    };
  }
  // else: full table reprocessing, no parameters needed
  
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  
  return response.json();
}

// Usage in webhook handler:
async function handleCalendarEventUpdate(event: any, supabase: any) {
  // 1. UPSERT to Bronze
  await supabase.from('bronze.calendar_events').upsert({
    google_event_id: event.id,
    data: event
  }, { onConflict: 'google_event_id' });
  
  // 2. Trigger downstream processing
  await triggerReprocessing('calendar_events', 'bronze', {
    dateRange: {
      from: new Date(event.start.dateTime),
      to: new Date(event.end.dateTime)
    }
  });
}
```

### Reconciliation Integration

**Daily reconciliation uses same dependency logic:**

```typescript
// app/api/cron/reconcile/route.ts
export async function GET(request: NextRequest) {
  // 1. Reconcile all Bronze tables
  await reconcileKajabiMembers();
  await reconcileCalendarEvents();
  await reconcileZoomData();
  await reconcileStripeSubscriptions();
  
  // 2. Find all Silver tables that might be affected
  const allSilverTables = Object.keys(SILVER_DEPENDENCIES);
  
  // 3. Process in dependency order
  const order = getProcessingOrder(allSilverTables);
  
  console.log(`Full reconciliation: ${order.join(' → ')}`);
  
  for (const table of order) {
    await processTable(table);
  }
  
  return NextResponse.json({
    success: true,
    processed: order
  });
}
```

### Reprocessing Patterns

Silver tables have two reprocessing patterns based on their data type:

#### Pattern 1: Full Table Reprocessing

**For entity state tables** (members, subscriptions, channel access):
- No meaningful date range
- Entire table represents current state
- DELETE all rows, INSERT all fresh rows
- **MUST use atomic transaction** (no partial state visible to users)

```typescript
// lib/processing/full-table.ts
export async function reprocessFullTable(table: string) {
  const deps = SILVER_DEPENDENCIES[table];
  if (deps.processingScope !== 'full') {
    throw new Error(`Table ${table} is not full-table scope`);
  }
  
  // Use PostgreSQL function for atomic DELETE + INSERT
  const supabase = await createClient();
  const newData = await computeTableData(table);
  
  await supabase.rpc(`reprocess_${table}_atomic`, {
    new_data: newData
  });
}

async function computeTableData(table: string): Promise<any[]> {
  // Load from Bronze + Local, compute Silver records
  // (Table-specific logic)
}
```

**SQL implementation (atomic transaction):**

```sql
-- Example: members table
CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: no partial state visible
  DELETE FROM members;
  
  INSERT INTO members (id, name, email, kajabi_contact_id, ...)
  SELECT * FROM jsonb_populate_recordset(null::members, new_data);
END;
$$ LANGUAGE plpgsql;
```

**Why atomic transactions:**
```typescript
// WITHOUT transaction (BROKEN - users see partial state):
await supabase.from('members').delete().neq('id', '0');
// ⚠️ Table is now EMPTY - concurrent queries return no members!
await supabase.from('members').insert(newMembers);
// ✅ Data restored, but users saw broken state for seconds/minutes

// WITH transaction (CORRECT - atomic):
await supabase.rpc('reprocess_members_atomic', { new_data: newMembers });
// ✅ Entire operation atomic - users never see partial state
```

#### Pattern 2: Date-Scoped Reprocessing

**For time-series tables** (prickles, prickle_attendance, product access history):
- Natural date range (prickle_date, created_at)
- Large datasets (process weeks/months at a time)
- Incremental updates (reprocess just affected dates)
- **MUST use atomic transaction** (no partial date ranges visible)

```typescript
// lib/processing/date-scoped.ts
export async function reprocessDateRange(
  table: string,
  from: Date,
  to: Date
) {
  const deps = SILVER_DEPENDENCIES[table];
  if (deps.processingScope !== 'date-range') {
    throw new Error(`Table ${table} is not date-scoped`);
  }
  
  // Use PostgreSQL function for atomic DELETE + INSERT
  const supabase = await createClient();
  const newData = await computeTableDataForRange(table, from, to);
  
  await supabase.rpc(`reprocess_${table}_atomic`, {
    from_date: from.toISOString(),
    to_date: to.toISOString(),
    new_data: newData
  });
}
```

**SQL implementation (atomic transaction):**

```sql
-- Example: prickles table
CREATE OR REPLACE FUNCTION reprocess_prickles_atomic(
  from_date DATE,
  to_date DATE,
  new_data JSONB
) RETURNS void AS $$
BEGIN
  -- Single transaction: no partial date range visible
  DELETE FROM prickles 
  WHERE prickle_date >= from_date 
    AND prickle_date <= to_date;
  
  INSERT INTO prickles (id, prickle_date, calendar_event_id, ...)
  SELECT * FROM jsonb_populate_recordset(null::prickles, new_data);
END;
$$ LANGUAGE plpgsql;
```

**Why date scoping matters:**

```typescript
// Event: Single calendar event changes for April 21
await handleCalendarEventUpdate({ date: '2026-04-21', ... });

// INEFFICIENT: Reprocess entire prickles table
await reprocessFullTable('prickles');  // ❌ Processes ALL months

// EFFICIENT: Reprocess only April 21
await reprocessDateRange('prickles', 
  new Date('2026-04-21'), 
  new Date('2026-04-21')
);  // ✅ Processes only 1 day
```

#### Choosing the Right Pattern

| Table Type | Example | Pattern | Why |
|------------|---------|---------|-----|
| Entity state | `members`, `member_subscriptions` | Full table | Current state, no history, small dataset |
| Event history | `prickles`, `prickle_attendance` | Date-scoped | Time-series, large dataset, incremental updates |
| Access log | `member_product_access` | Date-scoped | Track when access granted (history matters) |
| Config | `member_slack_channels` | Full table | Current access state, small dataset |

### Example: Full Cascade

**Example 1: Calendar event changes (date-scoped cascade):**

```typescript
// Webhook: Calendar event updated
await handleCalendarEventUpdate({
  id: 'event_123',
  summary: 'Morning Writing',
  start: { dateTime: '2026-04-21T09:00:00Z' },
  end: { dateTime: '2026-04-21T11:00:00Z' }
});

// Execution:
// 1. UPSERT to bronze.calendar_events
await supabase.from('bronze.calendar_events').upsert({ ... });

// 2. Find affected Silver tables
const affected = getAffectedSilverTables('calendar_events', 'bronze');
// → ['prickles', 'attendance']

// 3. Determine processing order
const order = getProcessingOrder(affected);
// → ['prickles', 'attendance']

// 4. Reprocess prickles for April 21 (atomic transaction)
await supabase.rpc('reprocess_prickles_atomic', {
  from_date: '2026-04-21',
  to_date: '2026-04-21',
  new_data: computePricklesForDate('2026-04-21')
});
// SQL executes: DELETE WHERE prickle_date = '2026-04-21'
//               INSERT fresh data
// Users never see partial state

// 5. Reprocess prickle_attendance for April 21 (atomic transaction)
await supabase.rpc('reprocess_prickle_attendance_atomic', {
  from_date: '2026-04-21',
  to_date: '2026-04-21',
  new_data: computeAttendanceForDate('2026-04-21')
});
// SQL executes: DELETE WHERE prickle_date = '2026-04-21'
//               INSERT fresh data
```

**Example 2: Member data changes (full-table cascade):**

```typescript
// Webhook: Kajabi contact updated
await handleContactUpdated({
  id: 'contact_123',
  email: 'newemail@example.com',
  name: 'Updated Name'
});

// Execution:
// 1. UPSERT to bronze.kajabi_members
await supabase.from('bronze.kajabi_members').upsert({ ... });

// 2. Find affected Silver tables
const affected = getAffectedSilverTables('kajabi_members', 'bronze');
// → ['members', 'prickle_attendance']  (prickle_attendance depends on members for dedup)

// 3. Determine processing order
const order = getProcessingOrder(affected);
// → ['members', 'attendance']  (members first, then attendance)

// 4. Reprocess members (full table, atomic transaction)
await supabase.rpc('reprocess_members_atomic', {
  new_data: computeAllMembers()
});
// SQL executes: DELETE FROM members;
//               INSERT all fresh members
// Atomic - users never see empty table

// 5. Reprocess prickle_attendance (full table, or date-scoped if we track member changes)
// For simplicity, could skip if only member metadata changed (name, email)
// If member aliases changed, would need full prickle_attendance reprocessing
```

### Testing Dependency Management

**Required tests:**

```typescript
// tests/unit/processing/dependencies.test.ts
describe('Dependency Management', () => {
  test('getProcessingOrder respects dependencies', () => {
    const order = getProcessingOrder(['prickle_attendance', 'members', 'prickles']);
    
    // members has no Silver dependencies → first
    expect(order[0]).toBe('members');
    
    // prickles has no Silver dependencies → before prickle_attendance
    expect(order.indexOf('prickles')).toBeLessThan(order.indexOf('prickle_attendance'));
    
    // prickle_attendance depends on members and prickles → last
    expect(order[order.length - 1]).toBe('prickle_attendance');
  });
  
  test('getAffectedSilverTables finds direct dependencies', () => {
    const affected = getAffectedSilverTables('calendar_events', 'bronze');
    expect(affected).toContain('prickles');
  });
  
  test('getAffectedSilverTables finds transitive dependencies', () => {
    const affected = getAffectedSilverTables('calendar_events', 'bronze');
    // prickles depends on calendar_events
    // prickle_attendance depends on prickles
    expect(affected).toContain('prickles');
    expect(affected).toContain('prickle_attendance');
  });
  
  test('circular dependencies throw error', () => {
    // If we accidentally create: A depends on B, B depends on A
    const badDeps = {
      table_a: { bronze: [], local: [], silver: ['table_b'], processingScope: 'full' },
      table_b: { bronze: [], local: [], silver: ['table_a'], processingScope: 'full' }
    };
    
    expect(() => {
      getProcessingOrder(['table_a', 'table_b']);
    }).toThrow('Circular dependency detected');
  });
  
  test('processing scope configuration is valid', () => {
    for (const [table, deps] of Object.entries(SILVER_DEPENDENCIES)) {
      expect(['full', 'date-range']).toContain(deps.processingScope);
      
      if (deps.processingScope === 'date-range') {
        expect(deps.dateField).toBeDefined();
        expect(typeof deps.dateField).toBe('string');
      }
    }
  });
});

// tests/integration/processing/atomic-transactions.test.ts
describe('Atomic Transaction Reprocessing', () => {
  test('full-table reprocessing is atomic (no partial state)', async () => {
    const supabase = await createClient();
    
    // Seed initial data
    await supabase.from('members').insert([
      { id: 'uuid-1', email: 'user1@example.com', name: 'User 1' },
      { id: 'uuid-2', email: 'user2@example.com', name: 'User 2' }
    ]);
    
    // Start reprocessing in background
    const reprocessPromise = supabase.rpc('reprocess_members_atomic', {
      new_data: [
        { id: 'uuid-3', email: 'user3@example.com', name: 'User 3' }
      ]
    });
    
    // Concurrent query DURING reprocessing should see either:
    // - Old state (2 members)
    // - New state (1 member)
    // NEVER partial state (0 members)
    const { count } = await supabase
      .from('members')
      .select('*', { count: 'exact' });
    
    expect(count).toBeGreaterThan(0); // Never see empty table
    
    await reprocessPromise;
    
    // After reprocessing, should see new state
    const { count: finalCount } = await supabase
      .from('members')
      .select('*', { count: 'exact' });
    
    expect(finalCount).toBe(1);
  });
  
  test('date-scoped reprocessing is atomic (no partial date range)', async () => {
    const supabase = await createClient();
    
    // Seed initial data
    await supabase.from('prickles').insert([
      { prickle_date: '2026-04-21', name: 'Morning Writing' },
      { prickle_date: '2026-04-22', name: 'Evening Writing' }
    ]);
    
    // Reprocess April 21 only
    const reprocessPromise = supabase.rpc('reprocess_prickles_atomic', {
      from_date: '2026-04-21',
      to_date: '2026-04-21',
      new_data: [
        { prickle_date: '2026-04-21', name: 'Updated Morning Writing' }
      ]
    });
    
    // Concurrent query for April 21 should see either:
    // - Old data (1 prickle with old name)
    // - New data (1 prickle with new name)
    // NEVER zero prickles for that date
    const { count } = await supabase
      .from('prickles')
      .select('*', { count: 'exact' })
      .eq('prickle_date', '2026-04-21');
    
    expect(count).toBeGreaterThan(0); // Never see missing date
    
    await reprocessPromise;
    
    // April 22 should be unchanged
    const { data: april22 } = await supabase
      .from('prickles')
      .select('name')
      .eq('prickle_date', '2026-04-22')
      .single();
    
    expect(april22.name).toBe('Evening Writing');
  });
});
```

### Implementation Checklist

**When adding a new Silver table:**

1. ✅ Declare dependencies in `SILVER_DEPENDENCIES`
   - List Bronze, Local, and Silver dependencies
   - Set `processingScope`: 'full' or 'date-range'
   - If 'date-range', specify `dateField`

2. ✅ Create atomic reprocessing SQL function
   - `reprocess_{table}_atomic()` for full-table scope
   - `reprocess_{table}_atomic(from_date, to_date, new_data)` for date-range scope
   - Ensure single transaction (DELETE + INSERT together)

3. ✅ Implement processing route (`/api/process/{table}`)
   - Accept `fromDate`/`toDate` if date-scoped
   - Compute new data from Bronze + Local sources
   - Call atomic reprocessing function
   - Return success/error status

4. ✅ Update webhooks to call `triggerReprocessing()` after Bronze UPSERT
   - Pass date range if applicable
   - Let dependency system cascade to downstream tables

5. ✅ Test processing correctness
   - Full table: DELETE all, INSERT fresh data
   - Date-scoped: DELETE date range, INSERT fresh for range
   - Atomic: No partial state visible during reprocessing

6. ✅ Test dependency cascading
   - Upstream Bronze change triggers this table
   - This table triggers downstream Silver tables
   - Processing order is correct

**When adding a new Bronze table:**

1. ✅ Update any Silver table dependencies that use it
2. ✅ Add webhook handler with `triggerReprocessing()` call
3. ✅ Add reconciliation logic
4. ✅ Test that changes cascade correctly

### Benefits

✅ **Correct processing order** - Never process prickle_attendance before members  
✅ **Incremental updates** - Only reprocess affected tables/dates  
✅ **No downtime** - Atomic transactions prevent partial state visibility  
✅ **Webhook reliability** - Changes propagate automatically to downstream tables  
✅ **Reconciliation completeness** - Full reprocessing in correct order  
✅ **Clear mental model** - Dependencies explicit, not implicit  
✅ **Easy to extend** - Add table, declare deps, implement atomic function, done  
✅ **Production safe** - Users never see incomplete data during reprocessing  
✅ **Performance** - Date-scoped tables only reprocess affected dates (not entire table)  

### Future Enhancements

**Not needed for MVP, but possible later:**

- **Vercel Workflows orchestration**: Use workflows to run processing steps in parallel where possible
- **Change tracking**: Only reprocess if Bronze/Local actually changed (skip if identical UPSERT)
- **Record-level change detection** (like dbt incremental merge): Instead of DELETE + INSERT entire date range, compare individual records by hash or `updated_at` and only UPSERT changed records. More complex, requires:
  - Reliable `updated_at` timestamps in source data
  - Hash computation for change detection
  - Orphan detection (records deleted from source)
  - Much more complex than atomic DELETE + INSERT
  - Only needed if transaction timeouts become an issue
- **Dependency visualization**: Generate diagram showing table dependencies

**Note:** "Date-scoped reprocessing" (Pattern 2 above) is NOT a future enhancement - it's supported from day 1 as the standard approach for time-series tables.

---

## Testing Strategy

### Local-First Development

**Goal:** Fast feedback loops without hitting production APIs

**Setup:**
- Local Supabase (`npx supabase start`)
- stripe-mock for Stripe API
- Slack mocks for Slack API
- CSV imports for initial test data (local only)

### Test Organization

```
tests/
├── unit/              # Pure functions, no I/O
├── integration/       # Workflows + DB, local Supabase
│   ├── workflows/
│   ├── webhooks/
│   └── processing/
├── api/               # Full API route handlers (all local, not true e2e)
└── fixtures/          # Test data
```

### Local Environment Setup

**Supabase:**
```bash
npm install supabase --save-dev
npx supabase init
npx supabase start
npx supabase db reset
```

**stripe-mock:**
```bash
brew install stripe/stripe-mock/stripe-mock
stripe-mock  # Runs on port 12111
```

**Environment variables:**
```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... (from supabase start)
SUPABASE_SERVICE_ROLE_KEY=eyJ... (from supabase start)

STRIPE_SECRET_KEY=sk_test_mock
SLACK_BOT_TOKEN=xoxb-mock
EMAIL_PROVIDER=mock  # or resend, sendgrid, ses
EMAIL_API_KEY=mock_key
```

**Client configuration for mocks:**
```typescript
// lib/stripe/client.ts
export function createStripeClient() {
  const apiKey = process.env.STRIPE_SECRET_KEY!;
  
  if (apiKey === 'sk_test_mock') {
    return new Stripe(apiKey, {
      host: 'localhost',
      port: 12111,
      protocol: 'http',
    });
  }
  
  return new Stripe(apiKey);
}
```

### Test Requirements

**Every Bronze import route:**
- ✅ Idempotency test (re-import same data = no duplicates)
- ✅ Update test (changed data updates correctly)

**Every Silver processing route:**
- ✅ Reprocessability test (deleted source → removed from Silver)
- ✅ Update test (changed source → updated Silver)

**Every workflow:**
- ✅ Happy path test
- ✅ Failure handling test (what happens if Stripe fails?)
- ✅ Idempotency test (can retry safely)

### Running Tests

```json
// package.json
{
  "scripts": {
    "test": "vitest run",
    "test:unit": "vitest run tests/unit",
    "test:integration": "vitest run tests/integration",
    "test:watch": "vitest watch tests/integration",
    
    "supabase:start": "supabase start",
    "supabase:reset": "supabase db reset",
    "stripe-mock": "stripe-mock"
  }
}
```

**Local development flow:**
```bash
# Terminal 1: Supabase
npm run supabase:start

# Terminal 2: stripe-mock
npm run stripe-mock

# Terminal 3: Tests in watch mode
npm run test:watch
```

---

## Technology Choices

### Vercel Workflows

**Use for:** Multi-step operations requiring retries and observability

**Why:**
- Built-in retry logic (no manual orchestration)
- Vercel dashboard shows workflow runs and failures
- Durable execution (steps don't re-run on retry)
- Free tier: 50k steps/month (sufficient for our scale)

**When to use:**
- Hiatus start/end (Stripe + Slack + email)
- 180 Program enrollment (refund + pause + channels)
- Complex onboarding flows

**When NOT to use:**
- Simple webhook handlers (just UPSERT to Bronze)
- Single database operations
- Read-only operations

**Example:**
```typescript
export async function startHiatusWorkflow(memberId: string) {
  "use workflow";
  
  await pauseStripeSubscriptions(memberId);  // Step 1
  await removeFromSlackChannels(memberId);   // Step 2 (retries if Slack fails)
  await sendHiatusEmail(memberId);           // Step 3
}
```

### Database

**Supabase (PostgreSQL):**
- Bronze schema hidden from API
- Public schema exposed with RLS
- Use `service_role` key for server-side writes to bypass RLS

**Query Limits:**
- Default 1000-row limit per query
- **Always paginate** for tables that could exceed 1000 rows
- Use `range(offset, offset + BATCH_SIZE - 1)` for pagination

**Example:**
```typescript
let allRows: any[] = [];
let offset = 0;
const BATCH_SIZE = 1000;
let hasMore = true;

while (hasMore) {
  const { data: batch } = await supabase
    .from("large_table")
    .select("*")
    .range(offset, offset + BATCH_SIZE - 1);
  
  if (batch && batch.length > 0) {
    allRows = allRows.concat(batch);
    offset += batch.length;
    hasMore = batch.length === BATCH_SIZE;
  } else {
    hasMore = false;
  }
}
```

### Email Provider

**Pluggable design:** Support multiple email providers via common interface

```typescript
// lib/email/client.ts
export interface EmailClient {
  sendEmail(params: EmailParams): Promise<void>;
}

export function createEmailClient(): EmailClient {
  const provider = process.env.EMAIL_PROVIDER || 'console';
  
  switch (provider) {
    case 'resend':
      return new ResendClient(process.env.EMAIL_API_KEY!);
    case 'sendgrid':
      return new SendGridClient(process.env.EMAIL_API_KEY!);
    case 'ses':
      return new SESClient(process.env.EMAIL_API_KEY!);
    case 'console':
      return new ConsoleEmailClient(); // For local testing
    case 'mock':
      return new MockEmailClient(); // For automated tests
    default:
      throw new Error(`Unknown email provider: ${provider}`);
  }
}
```

**Why pluggable:**
- Evaluate providers (Resend, SendGrid, AWS SES) before locking in
- Easy to switch without changing workflow code
- Local testing uses console/mock (no API calls)

### Deployment

**Vercel:**
- Next.js 15 App Router
- Vercel Workflows for durable execution
- Cron jobs for reconciliation
- Hobby tier: 300s max function duration

**Environment variables:**
- Stored in Vercel project settings
- Local: `.env.local` (git-ignored)
- Production: Set via Vercel dashboard

---

## Implementation Standards

These implementation standards ensure consistency across all features. Follow these patterns unless there's a documented reason to deviate.

### 1. HTTP Methods for State Mutation

**Rule:** All endpoints that mutate state (import, process, reconcile) MUST use POST, never GET.

**Rationale:**
- REST semantics: GET is idempotent and cacheable, POST is for mutations
- Cron jobs can trigger POST endpoints just as easily as GET
- Vercel cron jobs accept any HTTP method
- Prevents accidental state changes from browser prefetch, link crawlers, etc.

**Apply to:**
- `/api/reconcile/*` - Daily reconciliation jobs
- `/api/process/*` - Silver layer processing
- `/api/import/*` - Bronze layer imports
- `/api/webhooks/*` - Already POST (webhook standard)

```typescript
// ✅ CORRECT
export async function POST(request: NextRequest) {
  // Reconciliation logic that mutates Bronze layer
}

// ❌ WRONG
export async function GET(request: NextRequest) {
  // Any mutation in a GET handler
}
```

### 2. Code Reuse: Service Modules Not HTTP

**Rule:** Extract shared business logic into service modules. Both webhooks and reconciliation call these services directly, not via HTTP.

**Rationale:**
- Avoid HTTP overhead for internal calls
- Easier to test (unit test the service, integration test the routes)
- Better error handling (no HTTP serialization of errors)
- Clearer dependency graph
- Enables transaction boundaries across operations

**Directory structure:**
```
lib/
  services/
    calendar-service.ts      - Calendar sync & import
    zoom-service.ts          - Zoom sync & import
    prickle-service.ts       - Prickle processing
    prickle-attendance-service.ts    - Prickle attendance processing
    member-service.ts        - Member processing
  integrations/
    google-calendar.ts       - Google Calendar API client
    zoom.ts                  - Zoom API client
    slack.ts                 - Slack API client
```

**Pattern:**
```typescript
// lib/services/calendar-service.ts
export class CalendarService {
  constructor(private supabase: SupabaseClient) {}
  
  async syncEvents(fromDate: Date, toDate: Date): Promise<void> {
    const events = await fetchCalendarEvents(fromDate, toDate);
    await this.importEvents(events);
  }
  
  async importEvents(events: CalendarEvent[]): Promise<void> {
    await this.supabase.from("bronze.calendar_events").upsert(events, {
      onConflict: 'google_event_id'
    });
  }
}

// app/api/webhooks/calendar/route.ts
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const calendarService = new CalendarService(supabase);
  const prickleService = new PrickleService(supabase);
  
  const fromDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await calendarService.syncEvents(fromDate, new Date());
  await prickleService.processPrickles(fromDate, new Date());
  
  return NextResponse.json({ received: true });
}

// app/api/reconcile/calendar/route.ts
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const calendarService = new CalendarService(supabase);
  const prickleService = new PrickleService(supabase);
  
  const fromDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await calendarService.syncEvents(fromDate, new Date());
  await prickleService.processPrickles(fromDate, new Date());
  
  return NextResponse.json({ success: true });
}
```

### 3. Integration Clients: Class-Based API Wrappers

**Rule:** Use class-based API clients for external integrations. Use service classes for business logic.

**Rationale:**
- Encapsulation: API credentials, rate limiting, retry logic in one place
- Testability: Easy to mock entire integration (just mock the class)
- State management: Token caching, pagination state, connection pooling
- TypeScript interfaces for strong typing

**Pattern:**
```typescript
// lib/integrations/google-calendar.ts
export class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;
  
  constructor(credentials: GoogleCredentials) {
    const auth = new google.auth.OAuth2(
      credentials.clientId,
      credentials.clientSecret,
      credentials.redirectUri
    );
    auth.setCredentials({ refresh_token: credentials.refreshToken });
    this.calendar = google.calendar({ version: 'v3', auth });
  }
  
  async fetchEvents(
    calendarId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<CalendarEvent[]> {
    let allEvents: CalendarEvent[] = [];
    let pageToken: string | undefined;
    
    do {
      const response = await this.calendar.events.list({
        calendarId,
        timeMin: fromDate.toISOString(),
        timeMax: toDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
        pageToken
      });
      
      allEvents = allEvents.concat(response.data.items || []);
      pageToken = response.data.nextPageToken || undefined;
    } while (pageToken);
    
    return allEvents;
  }
}

// Usage in services
export class CalendarService {
  private calendar: GoogleCalendarClient;
  
  constructor(
    private supabase: SupabaseClient,
    calendarClient?: GoogleCalendarClient
  ) {
    this.calendar = calendarClient || new GoogleCalendarClient({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      refreshToken: process.env.GOOGLE_REFRESH_TOKEN!,
      redirectUri: process.env.GOOGLE_REDIRECT_URI!
    });
  }
  
  async syncEvents(fromDate: Date, toDate: Date): Promise<void> {
    const events = await this.calendar.fetchEvents(
      process.env.GOOGLE_CALENDAR_ID!,
      fromDate,
      toDate
    );
    await this.importEvents(events);
  }
}
```

### 4. API Path Structure

**Rule:** Group API routes by operation type, then by integration/entity.

**Standard:**
```
/api/{operation}/{integration-or-entity}[/{sub-resource}]
```

**Structure:**
```
/api/
  reconcile/           # Daily reconciliation (triggered by cron)
    calendar/
    zoom/
    kajabi/
  webhooks/            # Real-time event handlers
    calendar/
    zoom/
    slack/
  import/              # Manual/batch imports
    calendar/          # POST with CSV or JSON
    zoom/
      meetings/
      participants/
    kajabi/
      contacts/
      subscriptions/
  process/             # Silver layer processing
    prickles/
    prickle-attendance/
    members/
```

**Benefits:**
- Clear separation by operation type
- RESTful for entity operations
- RPC-style for processing/webhooks/reconciliation
- Consistent naming across integrations

### 5. Data Models and Types

**Rule:** Use TypeScript interfaces + Supabase type generation. Defer ORM adoption until pain points emerge.

**Rationale:**
- Next.js + Supabase works well with raw SQL and simple types
- ORMs add complexity (Prisma schema, migrations, codegen)
- Supabase client already provides type generation from DB schema

**Recommended approach:**

**Phase 1: TypeScript Interfaces (MVP)**
```typescript
// lib/types/models.ts
export interface Member {
  id: string;
  kajabi_contact_id: string;
  email: string;
  name: string;
  status: 'active' | 'inactive' | 'on_hiatus';
  created_at: string;
  updated_at: string;
}

const { data: members } = await supabase
  .from("members")
  .select("*")
  .returns<Member[]>();
```

**Phase 2: Supabase Type Generation (Recommended)**
```bash
npx supabase gen types typescript --project-id "$PROJECT_REF" --schema public > lib/types/database.ts
```

```typescript
import { Database } from '@/lib/types/database';

const supabase = createClient<Database>();
const { data } = await supabase.from("members").select("*");
// data is fully typed!
```

**When to add ORM:**
- Complex joins across 5+ tables become common
- Need advanced query builders
- Want model validation/hooks

### 6. Seed Data as SQL Migrations

**Rule:** Store seed data as SQL migrations, not as models/classes.

**Rationale:**
- SQL migrations are database-agnostic
- Easier to version control and review
- Supabase migrations run on both local and production
- No coupling to application code
- Can bootstrap fresh database without application running

**Pattern:**
```sql
-- supabase/migrations/20260422000001_seed_prickle_types.sql
-- Seed prickle types with actual event types from your calendar
INSERT INTO prickle_types (name, calendar_name_pattern, zoom_topic_pattern, default_duration_minutes)
VALUES
  ('Type 1', 'Pattern 1.*', 'Pattern 1.*', 60),
  ('Type 2', 'Pattern 2.*', 'Pattern 2.*', 90)
ON CONFLICT (name) DO UPDATE SET
  calendar_name_pattern = EXCLUDED.calendar_name_pattern,
  zoom_topic_pattern = EXCLUDED.zoom_topic_pattern,
  default_duration_minutes = EXCLUDED.default_duration_minutes;
```

**Local development:**
```bash
npx supabase db reset  # Reset to fresh state with seed data
npx supabase db push   # Apply new migrations
```

### 7. Testing with Mocks

**Rule:** Always use mocks/fakes for external services in tests. Never call real APIs.

**Rationale:**
- Tests must be fast (<1s per test)
- Tests must be deterministic (no flaky failures)
- Tests must work offline
- Tests must not consume API quotas

**Pattern:**
```typescript
// tests/mocks/google-calendar.mock.ts
export class MockGoogleCalendarClient implements GoogleCalendarClient {
  private mockEvents: CalendarEvent[] = [];
  
  setMockEvents(events: CalendarEvent[]) {
    this.mockEvents = events;
  }
  
  async fetchEvents(
    calendarId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<CalendarEvent[]> {
    return this.mockEvents.filter(event => {
      const eventDate = new Date(event.start.dateTime);
      return eventDate >= fromDate && eventDate <= toDate;
    });
  }
}

// tests/services/calendar-service.test.ts
describe('CalendarService', () => {
  it('handles 1000+ calendar events without timeout', async () => {
    const mockCalendar = new MockGoogleCalendarClient();
    const mockEvents = Array.from({ length: 1500 }, (_, i) => ({
      id: `event-${i}`,
      summary: 'Morning Writing',
      start: { dateTime: `2024-01-${(i % 30) + 1}T09:00:00Z` },
      end: { dateTime: `2024-01-${(i % 30) + 1}T11:00:00Z` }
    }));
    
    mockCalendar.setMockEvents(mockEvents);
    const service = new CalendarService(supabase, mockCalendar);
    
    await service.syncEvents(new Date('2024-01-01'), new Date('2024-01-31'));
    
    const { data } = await supabase.from("bronze.calendar_events").select("*");
    expect(data).toHaveLength(1500);
  });
});
```

### 8. Vercel Configuration as Code

**Rule:** Store all Vercel configuration in `vercel.json` or `vercel.ts`.

**Rationale:**
- Infrastructure as code
- Version controlled
- Preview environments inherit config
- No manual dashboard configuration

**Pattern:**
```json
// vercel.json
{
  "buildCommand": "npm run build",
  "framework": "nextjs",
  "crons": [
    {
      "path": "/api/reconcile/calendar",
      "schedule": "0 2 * * *"
    },
    {
      "path": "/api/reconcile/zoom",
      "schedule": "30 2 * * *"
    },
    {
      "path": "/api/reconcile/kajabi",
      "schedule": "0 3 * * *"
    }
  ]
}
```

**For dynamic configuration:**
```typescript
// vercel.ts
import { routes, type VercelConfig } from '@vercel/config/v1';

export const config: VercelConfig = {
  buildCommand: 'npm run build',
  framework: 'nextjs',
  crons: [
    { path: '/api/reconcile/calendar', schedule: '0 2 * * *' },
    { path: '/api/reconcile/zoom', schedule: '30 2 * * *' },
    { path: '/api/reconcile/kajabi', schedule: '0 3 * * *' }
  ]
};
```

**Environment Variables:**
- Store secrets as Vercel environment variables (not in vercel.json)
- Reference via `process.env.VARIABLE_NAME`

---

## Summary

This architecture provides:

✅ **Reliability** via webhooks + reconciliation  
✅ **Reprocessability** via DELETE + INSERT pattern  
✅ **Testability** via local Supabase + mocks  
✅ **Observability** via Vercel Workflows dashboard  
✅ **Maintainability** via clear layer separation

**All feature specs should:**
- Use Bronze for raw imports (UPSERT by natural key, always)
- Use Local for operational data we own
- Use Silver for derived data (DELETE + INSERT for reprocessability)
- Use Gold for aggregations (views)
- Webhooks trigger immediate Bronze UPSERT + Silver processing
- Daily reconciliation is the safety net (catches missed webhooks)
- Include reprocessability and idempotency tests
- Use Vercel Workflows for complex multi-step operations
- Use pluggable email client (don't hardcode provider)

---

**Next Steps:**

1. Review this architecture foundation
2. Build feature specs that follow these patterns
3. Reference this doc when making architectural decisions
