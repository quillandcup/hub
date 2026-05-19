# Kajabi Profile Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import photo, bio, and social links from Kajabi's `/v1/customers` data into the Silver `members` table and display them on the member-facing profile page (`/members/[id]`).

**Architecture:** One migration adds 5 nullable columns to `members` and updates the `reprocess_members_atomic` SQL function to include them. The Silver processing route builds a `customerByEmail` lookup from the already-synced `bronze.kajabi_customers` table and extracts the profile fields. The member profile page renders them in the header/bio area visible to all logged-in members.

**Tech Stack:** Next.js 15 App Router, Supabase (PostgreSQL), Tailwind CSS, Vitest (no new tests needed for this feature).

---

## File Map

| File | Status | Purpose |
|------|--------|---------|
| `supabase/migrations/20260519000001_add_profile_fields_to_members.sql` | Create | Add 5 columns + update `reprocess_members_atomic` |
| `app/api/process/members/route.ts` | Modify | Build `customerByEmail` map; extract profile fields per member |
| `app/(member)/members/[id]/MemberAvatar.tsx` | Create | Client component: photo with initials fallback on error |
| `app/(member)/members/[id]/page.tsx` | Modify | Fetch new fields; render avatar, bio, social links |

---

## Task 1: Database migration — add profile columns and update RPC

**Files:**
- Create: `supabase/migrations/20260519000001_add_profile_fields_to_members.sql`

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260519000001_add_profile_fields_to_members.sql`:

```sql
-- Add profile fields to Silver members table
-- Source: Kajabi /v1/customers endpoint (avatar, public_bio, socials)
ALTER TABLE members
  ADD COLUMN photo_url TEXT,
  ADD COLUMN bio TEXT,
  ADD COLUMN instagram_url TEXT,
  ADD COLUMN facebook_url TEXT,
  ADD COLUMN twitter_url TEXT;

-- Update reprocess_members_atomic to include the new profile fields
CREATE OR REPLACE FUNCTION reprocess_members_atomic(
  new_data JSONB
) RETURNS void AS $$
BEGIN
  INSERT INTO members (
    email, name, joined_at, status, plan, source, staff_role, user_id,
    kajabi_id, stripe_customer_id,
    photo_url, bio, instagram_url, facebook_url, twitter_url
  )
  SELECT
    value->>'email',
    value->>'name',
    (value->>'joined_at')::date,
    value->>'status',
    value->>'plan',
    value->>'source',
    value->>'staff_role',
    (value->>'user_id')::uuid,
    value->>'kajabi_id',
    value->>'stripe_customer_id',
    value->>'photo_url',
    value->>'bio',
    value->>'instagram_url',
    value->>'facebook_url',
    value->>'twitter_url'
  FROM jsonb_array_elements(new_data)
  ON CONFLICT (email) DO UPDATE SET
    name = EXCLUDED.name,
    joined_at = EXCLUDED.joined_at,
    status = EXCLUDED.status,
    plan = EXCLUDED.plan,
    source = EXCLUDED.source,
    staff_role = EXCLUDED.staff_role,
    user_id = EXCLUDED.user_id,
    kajabi_id = EXCLUDED.kajabi_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;
```

- [ ] **Step 2: Apply the migration**

```bash
npx supabase db push
```

Expected: migration applies cleanly, `members` table now has the 5 new columns.

- [ ] **Step 3: Verify columns exist**

```bash
npx supabase db diff
```

Expected: no drift (migration was applied).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260519000001_add_profile_fields_to_members.sql
git commit -m "feat: add profile columns to members table and update reprocess RPC"
```

---

## Task 2: Populate profile fields during Silver processing

**Files:**
- Modify: `app/api/process/members/route.ts`

The Bronze `kajabi_customers` table already contains `data JSONB` with the full Kajabi JSON:API customer object. Profile fields are at:
- `customer.data.attributes.avatar` → `photo_url`
- `customer.data.attributes.public_bio` → `bio`
- `customer.data.attributes.socials.instagram` → `instagram_url`
- `customer.data.attributes.socials.facebook` → `facebook_url`
- `customer.data.attributes.socials.twitter` → `twitter_url`

Contacts with no matching customer record (leads who never purchased) get `null` for all five.

- [ ] **Step 1: Add `customerByEmail` map after the existing `customerMap`**

In `app/api/process/members/route.ts`, find the block that builds `customerMap` (around line 81). Immediately after it, add:

```ts
// Profile field lookup: email → customer (for avatar, bio, socials)
const customerByEmail = new Map<string, any>();
if (customers && customers.length > 0) {
  for (const customer of customers) {
    customerByEmail.set(resolveEmail(customer.email), customer);
  }
}
```

- [ ] **Step 2: Extract profile fields when building each member record**

In the same file, find the `kajabiMembers.push({...})` call (around line 174). Add the five profile fields to the object:

```ts
const customer = customerByEmail.get(email);
const attrs = customer?.data?.attributes;

kajabiMembers.push({
  email,
  name,
  joined_at: contact.created_at_kajabi.split('T')[0],
  status,
  plan,
  source: 'kajabi',
  staff_role: null,
  user_id: null,
  kajabi_id: contact.kajabi_contact_id,
  stripe_customer_id: null,
  photo_url: attrs?.avatar || null,
  bio: attrs?.public_bio || null,
  instagram_url: attrs?.socials?.instagram || null,
  facebook_url: attrs?.socials?.facebook || null,
  twitter_url: attrs?.socials?.twitter || null,
  _metadata: { isTrial }
});
```

Replace the existing `kajabiMembers.push({...})` block entirely with the above.

- [ ] **Step 3: Also null-initialize profile fields for staff-only members**

Find the block that adds staff members with no Kajabi record (around line 223). Update it to include the five null fields:

```ts
membersByEmail.set(email, {
  email,
  name: staff.name,
  joined_at: staff.hire_date || '2020-01-01',
  status: 'inactive' as const,
  plan: null,
  source: 'staff',
  staff_role: staff.role,
  user_id: staff.user_id,
  kajabi_id: null,
  stripe_customer_id: null,
  photo_url: null,
  bio: null,
  instagram_url: null,
  facebook_url: null,
  twitter_url: null,
  _metadata: { isTrial: false }
});
```

- [ ] **Step 4: Verify processing works end-to-end**

Trigger member processing via the admin UI or curl:
```bash
curl -X POST http://localhost:3000/api/process/members \
  -H "Cookie: <your-admin-session-cookie>"
```

Then check a member in Supabase Studio (or via the profile page) to confirm `photo_url` / `bio` / social fields are populated where Kajabi has data.

- [ ] **Step 5: Commit**

```bash
git add app/api/process/members/route.ts
git commit -m "feat: extract Kajabi profile fields (photo, bio, socials) during Silver processing"
```

---

## Task 3: Create `MemberAvatar` client component

The member profile page is a server component, so the `onError` image fallback requires a tiny client component.

**Files:**
- Create: `app/(member)/members/[id]/MemberAvatar.tsx`

- [ ] **Step 1: Create `MemberAvatar.tsx`**

Create `app/(member)/members/[id]/MemberAvatar.tsx`:

```tsx
"use client"

import { useState } from "react"

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function getAvatarColor(name: string): string {
  const colors = [
    "bg-violet-500", "bg-blue-500", "bg-emerald-500",
    "bg-amber-500", "bg-rose-500", "bg-cyan-500",
  ]
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

interface MemberAvatarProps {
  name: string
  photoUrl: string | null
  size?: number
}

export default function MemberAvatar({ name, photoUrl, size = 56 }: MemberAvatarProps) {
  const [imgFailed, setImgFailed] = useState(false)

  if (photoUrl && !imgFailed) {
    return (
      <img
        src={photoUrl}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold ${getAvatarColor(name)}`}
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {getInitials(name)}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(member)/members/[id]/MemberAvatar.tsx
git commit -m "feat: add MemberAvatar client component with initials fallback"
```

---

## Task 4: Display profile fields on the member profile page

**Files:**
- Modify: `app/(member)/members/[id]/page.tsx`

- [ ] **Step 1: Update the `members` select to include profile fields**

Find the `.select(...)` call (around line 24). Replace it:

```ts
const { data: member } = await supabase
  .from("members")
  .select("id, name, email, joined_at, status, photo_url, bio, instagram_url, facebook_url, twitter_url")
  .eq("id", id)
  .single()
```

- [ ] **Step 2: Import `MemberAvatar`**

Add at the top of the file with the other imports:

```ts
import MemberAvatar from "./MemberAvatar"
```

- [ ] **Step 3: Replace the header section**

Find the `{/* Header */}` block (around line 102). Replace it entirely:

```tsx
{/* Header */}
<div className="mb-8 flex items-center gap-4">
  <MemberAvatar name={member.name} photoUrl={member.photo_url} size={56} />
  <div>
    <h1 className="text-3xl font-bold">{member.name}</h1>
    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
      Member since {joinedMonth} {joinedYear}
    </p>
  </div>
</div>
```

- [ ] **Step 4: Add bio and social links between the header and Community Stats card**

Insert the following JSX immediately after the header block and before the `{/* Tier 3: visible to all */}` Community Stats card:

```tsx
{/* Bio */}
{member.bio && (
  <p className="text-slate-700 dark:text-slate-300 mb-6 leading-relaxed">
    {member.bio}
  </p>
)}

{/* Social links */}
{(member.instagram_url || member.facebook_url || member.twitter_url) && (
  <div className="flex items-center gap-4 mb-6">
    {member.twitter_url && (
      <a
        href={member.twitter_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        aria-label="Twitter / X"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.254 5.622 5.91-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
        </svg>
      </a>
    )}
    {member.instagram_url && (
      <a
        href={member.instagram_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        aria-label="Instagram"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" />
        </svg>
      </a>
    )}
    {member.facebook_url && (
      <a
        href={member.facebook_url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
        aria-label="Facebook"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
        </svg>
      </a>
    )}
  </div>
)}
```

- [ ] **Step 5: Start the dev server and verify**

```bash
npm run dev
```

Open `http://localhost:3000/members/<any-member-id>`. Check:
- Avatar circle appears in the header (photo if Kajabi has one, initials otherwise)
- Bio paragraph shows when populated
- Social icon links appear and open in new tabs when URLs are present
- Members with no profile data look the same as before (no empty boxes)

- [ ] **Step 6: Commit**

```bash
git add app/(member)/members/[id]/page.tsx app/(member)/members/[id]/MemberAvatar.tsx
git commit -m "feat: display Kajabi profile photo, bio, and social links on member profile"
```
