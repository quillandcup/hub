# Member Identity Management

**Date:** 2026-04-21  
**Status:** Draft - Ready for Implementation  
**Dependencies:** [Architecture Foundation](./architecture-foundation.md)  
**Blocks:** All other features (attendance, dashboards, hiatus, etc.)

---

## Overview

### Problem Statement

Members interact with Quill & Cup across multiple systems:
- **Kajabi**: Sign up, purchase offers, manage subscriptions
- **Slack**: Join community channels, participate in discussions
- **Zoom**: Attend prickles (writing sessions)

**Challenges:**
1. **Email changes**: Members can change their email in Kajabi (new relationship, name change, etc.)
2. **Multiple identities**: Same person appears with different emails in different systems
3. **Deduplication**: Need single canonical member record across systems
4. **Attribution**: Need to link purchases, attendance, Slack activity to correct member

### Solution

**Member identity management system:**
- Import member data from Kajabi (bronze layer)
- Track email changes via aliases (local layer)
- Maintain canonical member records (silver layer)
- Support member lookup by any known email
- Handle email changes without breaking associations

---

## Data Model

### Bronze Layer: Kajabi Imports

**Schema:** `bronze` (hidden from Supabase API)

```sql
-- Raw member data from Kajabi
CREATE TABLE bronze.kajabi_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_contact_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_kajabi_members_email ON bronze.kajabi_members(email);
CREATE INDEX idx_kajabi_members_updated_at ON bronze.kajabi_members(updated_at);

COMMENT ON TABLE bronze.kajabi_members IS 'BRONZE: UPSERT by kajabi_contact_id';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_bronze_kajabi_members_updated_at 
  BEFORE UPDATE ON bronze.kajabi_members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Kajabi products catalog
CREATE TABLE bronze.kajabi_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_product_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  product_type TEXT,
  description TEXT,
  status TEXT,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_kajabi_products_name ON bronze.kajabi_products(name);
CREATE INDEX idx_kajabi_products_status ON bronze.kajabi_products(status);

COMMENT ON TABLE bronze.kajabi_products IS 'BRONZE: UPSERT by kajabi_product_id';

-- Kajabi offers (pricing/purchasing options)
CREATE TABLE bronze.kajabi_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kajabi_offer_id TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  price_in_cents INTEGER,
  payment_type TEXT,
  checkout_url TEXT,
  imported_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  data JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_kajabi_offers_title ON bronze.kajabi_offers(title);

COMMENT ON TABLE bronze.kajabi_offers IS 'BRONZE: UPSERT by kajabi_offer_id';
```

**Import Pattern (consistent UPSERT across all Bronze tables):**

**Members:**
- UPSERT by natural key (`kajabi_contact_id`)
- Re-importing updates `data`, `email`, `updated_at`
- Idempotent: re-import same data = no duplicates

**Products/Offers:**
- UPSERT by natural key (`kajabi_product_id`, `kajabi_offer_id`)
- Re-importing updates `data`, `updated_at`
- Idempotent: re-import same data = no duplicates

**Example:**
```sql
INSERT INTO bronze.kajabi_members (
  kajabi_contact_id, 
  email, 
  data
)
VALUES (
  'contact_123',
  'user@example.com',
  '{"id": "contact_123", "name": "John Doe", ...}'
)
ON CONFLICT (kajabi_contact_id) DO UPDATE
  SET email = EXCLUDED.email,
      data = EXCLUDED.data,
      imported_at = now(),
      updated_at = now();
```

### Local Layer: Email Aliases

**Schema:** `public` (operational data we own)

```sql
CREATE TABLE member_email_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL CHECK (source IN ('kajabi', 'slack', 'manual')),
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE INDEX idx_email_aliases_member ON member_email_aliases(member_id);
CREATE INDEX idx_email_aliases_email ON member_email_aliases(email);
CREATE INDEX idx_email_aliases_primary ON member_email_aliases(member_id, is_primary) WHERE is_primary = true;

COMMENT ON TABLE member_email_aliases IS 'LOCAL: Email aliasing - do not DELETE in reprocessing';
COMMENT ON COLUMN member_email_aliases.source IS 'Where this email came from: kajabi (current Kajabi email), slack (Slack profile), manual (admin override)';
COMMENT ON COLUMN member_email_aliases.is_primary IS 'Current primary email for this member (only one per member)';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_member_email_aliases_updated_at 
  BEFORE UPDATE ON member_email_aliases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Constraint: Only one primary email per member
CREATE UNIQUE INDEX idx_one_primary_per_member 
  ON member_email_aliases(member_id) 
  WHERE is_primary = true;
```

**Purpose:**
- Track all known emails for a member
- Handle email changes without breaking references
- Support lookup by any historical email
- Mark current primary email for communications

**Example Data:**
```
member_id | email                  | source  | is_primary
----------|------------------------|---------|------------
uuid-123  | old@gmail.com          | kajabi  | false
uuid-123  | current@gmail.com      | kajabi  | true
uuid-123  | slack@company.com      | slack   | false
```

### Silver Layer: Canonical Members

**Schema:** `public` (reprocessable from bronze + local)

```sql
CREATE TABLE members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL, -- Current primary email
  joined_at TIMESTAMP WITH TIME ZONE,
  status TEXT DEFAULT 'active',
  
  -- External system IDs
  kajabi_contact_id TEXT,
  stripe_customer_id TEXT,
  slack_user_id TEXT,
  
  -- Computed fields
  days_since_join INTEGER GENERATED ALWAYS AS (
    EXTRACT(DAY FROM (now() - joined_at))
  ) STORED,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE UNIQUE INDEX idx_members_email ON members(email);
CREATE UNIQUE INDEX idx_members_kajabi_contact ON members(kajabi_contact_id) WHERE kajabi_contact_id IS NOT NULL;
CREATE INDEX idx_members_stripe_customer ON members(stripe_customer_id);
CREATE INDEX idx_members_slack_user ON members(slack_user_id);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_days_since_join ON members(days_since_join);

COMMENT ON TABLE members IS 'SILVER: Reprocessable from bronze.kajabi_members + member_email_aliases';
COMMENT ON COLUMN members.email IS 'Current primary email (duplicated from member_email_aliases for convenience)';
COMMENT ON COLUMN members.status IS 'active, on_hiatus, cancelled, trial';

-- Trigger to auto-update updated_at
CREATE TRIGGER update_members_updated_at 
  BEFORE UPDATE ON members
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

**Processing Logic:**
1. Get latest Kajabi snapshot per email from `bronze.kajabi_members`
2. Find existing member via `member_email_aliases`
3. If exists: Update member record
4. If new: Create member record + primary email alias
5. Sync Kajabi contact ID, name, joined date

---

## Processing Logic

### Member Lookup by Email

**Purpose:** Find member by any known email (current or historical)

```typescript
// lib/members/lookup.ts
import { createClient } from "@/lib/supabase/server";

export async function findMemberByEmail(
  email: string
): Promise<{ id: string; name: string; email: string } | null> {
  const supabase = await createClient();
  
  // Look up via email alias
  const { data: alias } = await supabase
    .from("member_email_aliases")
    .select("member_id, members(*)")
    .eq("email", email)
    .single();
    
  if (!alias) return null;
  
  return {
    id: alias.member_id,
    name: alias.members.name,
    email: alias.members.email
  };
}
```

### Member Creation

**Purpose:** Create new member from Kajabi data

```typescript
// lib/members/create.ts
export async function createMemberFromKajabi(
  kajabiData: any
): Promise<{ id: string; email: string }> {
  const supabase = await createClient();
  
  const email = kajabiData.email;
  const name = kajabiData.name || 
    `${kajabiData.first_name} ${kajabiData.last_name}`.trim();
  
  // Create member
  const { data: member, error } = await supabase
    .from("members")
    .insert({
      name,
      email,
      joined_at: kajabiData.created_at,
      status: determineStatus(kajabiData),
      kajabi_contact_id: kajabiData.id
    })
    .select()
    .single();
    
  if (error) throw new Error(`Failed to create member: ${error.message}`);
  
  // Create primary email alias
  await supabase.from("member_email_aliases").insert({
    member_id: member.id,
    email: email,
    source: 'kajabi',
    is_primary: true
  });
  
  return { id: member.id, email: member.email };
}

function determineStatus(kajabiData: any): string {
  // Logic to determine status from Kajabi data
  // Could check trial status, subscription status, etc.
  return 'active';
}
```

### Email Change Handling

**Purpose:** Update aliases when member changes email in Kajabi

```typescript
// lib/members/update-email.ts
export async function handleEmailChange(
  oldEmail: string,
  newEmail: string
): Promise<void> {
  const supabase = await createClient();
  
  // Find member by old email
  const { data: oldAlias } = await supabase
    .from("member_email_aliases")
    .select("member_id")
    .eq("email", oldEmail)
    .eq("source", "kajabi")
    .single();
    
  if (!oldAlias) {
    console.warn(`No member found for old email: ${oldEmail}`);
    return;
  }
  
  // Mark old email as non-primary
  await supabase
    .from("member_email_aliases")
    .update({ is_primary: false })
    .eq("email", oldEmail);
  
  // Add new email as primary (or update if exists)
  await supabase
    .from("member_email_aliases")
    .upsert({
      member_id: oldAlias.member_id,
      email: newEmail,
      source: "kajabi",
      is_primary: true
    }, { onConflict: 'email' });
  
  // Update member's primary email field
  await supabase
    .from("members")
    .update({ email: newEmail })
    .eq("id", oldAlias.member_id);
}
```

### Member Deduplication

**Purpose:** Merge duplicate members (manual admin operation)

```typescript
// lib/members/deduplicate.ts
export async function mergeMemberAccounts(
  keepMemberId: string,
  mergeMemberId: string
): Promise<void> {
  const supabase = await createClient();
  
  // 1. Move all email aliases to kept member
  await supabase
    .from("member_email_aliases")
    .update({ member_id: keepMemberId })
    .eq("member_id", mergeMemberId);
  
  // 2. Move all attendance records
  await supabase
    .from("attendance")
    .update({ member_id: keepMemberId })
    .eq("member_id", mergeMemberId);
  
  // 3. Move all product access
  await supabase
    .from("member_product_access")
    .update({ member_id: keepMemberId })
    .eq("member_id", mergeMemberId)
    .onConflict(['member_id', 'kajabi_product_id'])
    .ignore(); // Keep existing if conflict
  
  // 4. Move Slack channels
  await supabase
    .from("member_slack_channels")
    .update({ member_id: keepMemberId })
    .eq("member_id", mergeMemberId)
    .onConflict(['member_id', 'slack_channel_id'])
    .ignore();
  
  // 5. Delete merged member
  await supabase
    .from("members")
    .delete()
    .eq("id", mergeMemberId);
}
```

---

## API Routes

### Kajabi Webhook Handler

**File:** `app/api/webhooks/kajabi/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { handleEmailChange } from "@/lib/members/update-email";
import crypto from "crypto";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("x-kajabi-signature");
  
  if (!verifyKajabiSignature(body, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }
  
  const event = JSON.parse(body);
  const supabase = await createClient();
  
  switch (event.event_type) {
    case 'contact.updated':
      await handleContactUpdated(event.data, supabase);
      break;
      
    case 'offer.purchased':
      await handleOfferPurchased(event.data, supabase);
      break;
      
    default:
      console.log(`Unhandled Kajabi event: ${event.event_type}`);
  }
  
  return NextResponse.json({ received: true });
}

function verifyKajabiSignature(body: string, signature: string | null): boolean {
  if (!signature) return false;
  const secret = process.env.KAJABI_WEBHOOK_SECRET!;
  const hash = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return hash === signature;
}

async function handleContactUpdated(contact: any, supabase: any) {
  // UPSERT to bronze layer
  await supabase.from("bronze.kajabi_members").upsert({
    kajabi_contact_id: contact.id,
    email: contact.email,
    data: contact
  }, { onConflict: 'kajabi_contact_id' });
  
  // Handle email change
  const oldEmail = contact.previous_attributes?.email;
  if (oldEmail && oldEmail !== contact.email) {
    await handleEmailChange(oldEmail, contact.email);
  }
  
  // Update Silver layer (members table)
  await syncMemberFromBronze(contact.id, supabase);
}

async function handleOfferPurchased(data: any, supabase: any) {
  // Store purchase data
  // Trigger onboarding workflow if new member
  // (Covered in separate onboarding spec)
}

async function syncMemberFromBronze(kajabiContactId: string, supabase: any) {
  // Get bronze record
  const { data: bronze } = await supabase
    .from('bronze.kajabi_members')
    .select('*')
    .eq('kajabi_contact_id', kajabiContactId)
    .single();
  
  if (!bronze) return;
  
  const kajabiData = bronze.data;
  const name = kajabiData.name || 
    `${kajabiData.first_name} ${kajabiData.last_name}`.trim();
  
  // Update or create member in Silver layer
  await supabase.from('members').upsert({
    kajabi_contact_id: kajabiContactId,
    name: name,
    email: bronze.email,
    joined_at: kajabiData.created_at,
    status: 'active'
  }, { 
    onConflict: 'kajabi_contact_id',
    ignoreDuplicates: false 
  });
}
```

### Kajabi Reconciliation

**File:** `app/api/cron/reconcile-kajabi/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  const supabase = await createClient();
  
  // Fetch all members from Kajabi API
  const members = await fetchAllKajabiMembers();
  
  // UPSERT to bronze layer
  for (const member of members) {
    await supabase.from("bronze.kajabi_members").upsert({
      kajabi_contact_id: member.id,
      email: member.email,
      data: member
    }, { onConflict: 'kajabi_contact_id' });
  }
  
  // Trigger full member processing (reprocess Silver from Bronze)
  await fetch('/api/process/members', { method: 'POST' });
  
  return NextResponse.json({
    success: true,
    imported: members.length
  });
}

async function fetchAllKajabiMembers(): Promise<any[]> {
  const kajabiApiUrl = process.env.KAJABI_API_URL!;
  const clientId = process.env.KAJABI_API_CLIENT_ID!;
  const clientSecret = process.env.KAJABI_API_CLIENT_SECRET!;
  
  // Get OAuth token
  const tokenResponse = await fetch(`${kajabiApiUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });
  
  const { access_token } = await tokenResponse.json();
  
  // Paginate through all members
  let allMembers: any[] = [];
  let page = 1;
  let hasMore = true;
  
  while (hasMore) {
    const response = await fetch(
      `${kajabiApiUrl}/contacts?page=${page}&per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    const data = await response.json();
    allMembers = allMembers.concat(data.contacts || []);
    
    hasMore = data.contacts && data.contacts.length === 100;
    page++;
  }
  
  return allMembers;
}
```

### Member Processing

**File:** `app/api/process/members/route.ts`

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  
  // Get all members from bronze (one record per member now)
  const { data: bronzeMembers } = await supabase
    .from("bronze.kajabi_members")
    .select("*");
  
  if (!bronzeMembers || bronzeMembers.length === 0) {
    return NextResponse.json({ error: "No Kajabi data found" }, { status: 404 });
  }
  
  // DELETE all existing members (reprocessing)
  await supabase.from("members").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  
  // INSERT fresh members from bronze data
  const membersToInsert = bronzeMembers.map(bronze => {
    const kajabiData = bronze.data;
    return {
      name: kajabiData.name || `${kajabiData.first_name} ${kajabiData.last_name}`.trim(),
      email: bronze.email,
      joined_at: kajabiData.created_at,
      status: 'active', // TODO: Derive from Kajabi data
      kajabi_contact_id: bronze.kajabi_contact_id
    };
  });
  
  const { data: insertedMembers, error } = await supabase
    .from("members")
    .insert(membersToInsert)
    .select();
  
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  
  // Create email aliases for all members
  const aliasesToInsert = insertedMembers.map(member => ({
    member_id: member.id,
    email: member.email,
    source: 'kajabi',
    is_primary: true
  }));
  
  await supabase.from("member_email_aliases").insert(aliasesToInsert);
  
  return NextResponse.json({
    success: true,
    processed: insertedMembers.length
  });
}
```

---

## Testing Requirements

### Idempotency Tests

**Location:** `tests/api/idempotency/kajabi-import.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'vitest';
import { createClient } from '@/lib/supabase/server';

describe('Kajabi Member Import Idempotency', () => {
  beforeEach(async () => {
    const supabase = await createClient();
    await supabase.from('bronze.kajabi_members').delete().neq('id', '0');
  });
  
  test('re-importing same member does not create duplicates', async () => {
    const supabase = await createClient();
    const memberData = {
      kajabi_contact_id: 'contact_123',
      email: 'test@example.com',
      data: { id: 'contact_123', name: 'Test User' }
    };
    
    // First import
    await supabase.from('bronze.kajabi_members').upsert(
      memberData,
      { onConflict: 'kajabi_contact_id' }
    );
    
    const { count: count1 } = await supabase
      .from('bronze.kajabi_members')
      .select('*', { count: 'exact' })
      .eq('kajabi_contact_id', 'contact_123');
    
    // Second import (same data) - should not create duplicate
    await supabase.from('bronze.kajabi_members').upsert(
      memberData,
      { onConflict: 'kajabi_contact_id' }
    );
    
    const { count: count2 } = await supabase
      .from('bronze.kajabi_members')
      .select('*', { count: 'exact' })
      .eq('kajabi_contact_id', 'contact_123');
    
    // No duplicates
    expect(count2).toBe(count1);
    expect(count1).toBe(1);
  });
  
  test('re-importing with changed data updates record', async () => {
    const supabase = await createClient();
    
    // Import initial data
    await supabase.from('bronze.kajabi_members').upsert({
      kajabi_contact_id: 'contact_123',
      email: 'test@example.com',
      data: { id: 'contact_123', name: 'Old Name' }
    }, { onConflict: 'kajabi_contact_id' });
    
    // Import updated data
    await supabase.from('bronze.kajabi_members').upsert({
      kajabi_contact_id: 'contact_123',
      email: 'newemail@example.com',
      data: { id: 'contact_123', name: 'New Name' }
    }, { onConflict: 'kajabi_contact_id' });
    
    // Process members
    await fetch('/api/process/members', { method: 'POST' });
    
    // Should reflect updated data
    const { data: member } = await supabase
      .from('members')
      .select('name, email')
      .eq('kajabi_contact_id', 'contact_123')
      .single();
    
    expect(member.name).toBe('New Name');
    expect(member.email).toBe('newemail@example.com');
    
    // Should only have one member
    const { count } = await supabase
      .from('bronze.kajabi_members')
      .select('*', { count: 'exact' })
      .eq('kajabi_contact_id', 'contact_123');
    
    expect(count).toBe(1);
  });
});
```

### Email Change Tests

**Location:** `tests/integration/members/email-change.test.ts`

```typescript
describe('Email Change Handling', () => {
  test('email change updates aliases and preserves member ID', async () => {
    const supabase = await createClient();
    
    // Create member with initial email
    const { data: member } = await supabase.from('members').insert({
      name: 'Test User',
      email: 'old@example.com',
      kajabi_contact_id: 'kajabi-123'
    }).select().single();
    
    await supabase.from('member_email_aliases').insert({
      member_id: member.id,
      email: 'old@example.com',
      source: 'kajabi',
      is_primary: true
    });
    
    // Simulate email change webhook
    await handleEmailChange('old@example.com', 'new@example.com');
    
    // Old email should be non-primary alias
    const { data: oldAlias } = await supabase
      .from('member_email_aliases')
      .select('*')
      .eq('email', 'old@example.com')
      .single();
    
    expect(oldAlias.is_primary).toBe(false);
    expect(oldAlias.member_id).toBe(member.id);
    
    // New email should be primary alias
    const { data: newAlias } = await supabase
      .from('member_email_aliases')
      .select('*')
      .eq('email', 'new@example.com')
      .single();
    
    expect(newAlias.is_primary).toBe(true);
    expect(newAlias.member_id).toBe(member.id);
    
    // Member record should have new email
    const { data: updatedMember } = await supabase
      .from('members')
      .select('email')
      .eq('id', member.id)
      .single();
    
    expect(updatedMember.email).toBe('new@example.com');
    
    // Can still find member by old email
    const found = await findMemberByEmail('old@example.com');
    expect(found?.id).toBe(member.id);
  });
});
```

### Reprocessability Tests

**Location:** `tests/api/reprocessability/members.test.ts`

```typescript
describe('Member Reprocessability', () => {
  test('reprocessing reflects current bronze state', async () => {
    const supabase = await createClient();
    
    // Import two members
    await supabase.from('bronze.kajabi_members').insert([
      {
        email: 'user1@example.com',
        imported_at: new Date().toISOString(),
        data: { email: 'user1@example.com', name: 'User 1', id: 'k1' }
      },
      {
        email: 'user2@example.com',
        imported_at: new Date().toISOString(),
        data: { email: 'user2@example.com', name: 'User 2', id: 'k2' }
      }
    ]);
    
    // Process
    await fetch('/api/process/members', { method: 'POST' });
    
    const { count: count1 } = await supabase
      .from('members')
      .select('*', { count: 'exact' });
    
    expect(count1).toBe(2);
    
    // Delete one member from bronze
    await supabase
      .from('bronze.kajabi_members')
      .delete()
      .eq('email', 'user2@example.com');
    
    // Reprocess
    await fetch('/api/process/members', { method: 'POST' });
    
    const { count: count2 } = await supabase
      .from('members')
      .select('*', { count: 'exact' });
    
    // Should only have one member now
    expect(count2).toBe(1);
    
    const { data: remaining } = await supabase
      .from('members')
      .select('email')
      .single();
    
    expect(remaining.email).toBe('user1@example.com');
  });
});
```

---

## Deployment

### Environment Variables

```env
# Kajabi API
KAJABI_API_URL=https://api.kajabi.com
KAJABI_API_CLIENT_ID=your_client_id
KAJABI_API_CLIENT_SECRET=your_client_secret
KAJABI_WEBHOOK_SECRET=your_webhook_secret

# Cron authentication
CRON_SECRET=random_secret_for_cron_jobs
```

### Vercel Cron Configuration

```json
// vercel.json
{
  "crons": [
    {
      "path": "/api/cron/reconcile-kajabi",
      "schedule": "0 2 * * *"
    }
  ]
}
```

---

## Success Criteria

**Bronze Layer:**
- ✅ Kajabi member imports are idempotent (UPSERT by kajabi_contact_id)
- ✅ Re-importing same member updates `updated_at`, no duplicates
- ✅ Products and offers UPSERT correctly

**Local Layer:**
- ✅ Email aliases track all known emails per member
- ✅ Only one primary email per member (constraint enforced)
- ✅ Can find member by any alias

**Silver Layer:**
- ✅ Members table is reprocessable (DELETE + INSERT)
- ✅ Deleted Kajabi members removed from Silver
- ✅ Member lookup works by current or historical email

**Webhooks:**
- ✅ Contact updates UPSERT to Bronze immediately
- ✅ Silver layer (members table) updated immediately
- ✅ Email changes update aliases correctly
- ✅ Can still find member by old email after change
- ✅ Primary email updates propagate to members table

**Reconciliation:**
- ✅ Daily cron fetches all Kajabi members via API
- ✅ UPSERT to Bronze layer (idempotent)
- ✅ Triggers full Silver reprocessing (DELETE + INSERT)
- ✅ Processing handles 100+ members without timeout
- ✅ Missed webhooks caught and fixed by reconciliation

---

## Next Steps

1. ✅ Review this spec
2. Implement Bronze schema (migrations)
3. Implement Local schema (member_email_aliases)
4. Implement Silver schema (members table)
5. Build Kajabi webhook handler
6. Build reconciliation cron
7. Build processing route
8. Write tests (idempotency, reprocessability, email changes)
9. Deploy and test with real Kajabi data
