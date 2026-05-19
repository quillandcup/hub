# Kajabi Profile Fields — Design Spec

**Date:** 2026-05-19

## Overview

Import photo, bio, and social links from the Kajabi `/v1/customers` API endpoint into the Silver `members` table, then display them on the member-facing profile page (`/members/[id]`).

The "share with others" checkbox is out of scope; all imported profile fields are visible to any logged-in member.

## Scope

**In scope:**
- Add 5 columns to `members`: `photo_url`, `bio`, `instagram_url`, `facebook_url`, `twitter_url`
- Populate during Silver processing from `bronze.kajabi_customers.data`
- Display on `/members/[id]` for all logged-in members

**Out of scope:**
- "Share with others" consent toggle
- `/profile` (own settings page) or admin member detail page

## Data Source

All five fields come from the Kajabi `/v1/customers` endpoint, already synced into `bronze.kajabi_customers.data` (full JSON:API object). Field mapping:

| Member column | Kajabi path |
|---|---|
| `photo_url` | `data.attributes.avatar` |
| `bio` | `data.attributes.public_bio` |
| `instagram_url` | `data.attributes.socials.instagram` |
| `facebook_url` | `data.attributes.socials.facebook` |
| `twitter_url` | `data.attributes.socials.twitter` |

Contacts with no customer record (leads who never purchased) get `null` for all five fields.

## Database Migration

Single migration adds 5 nullable `TEXT` columns to the Silver `members` table and updates `reprocess_members_atomic` to include them in the UPSERT.

```sql
ALTER TABLE members
  ADD COLUMN photo_url TEXT,
  ADD COLUMN bio TEXT,
  ADD COLUMN instagram_url TEXT,
  ADD COLUMN facebook_url TEXT,
  ADD COLUMN twitter_url TEXT;
```

`reprocess_members_atomic(new_data JSONB)` is updated to `SELECT` and `DO UPDATE SET` the five new fields from the incoming JSONB array elements.

## Silver Processing (`/api/process/members`)

1. Build a `customerByEmail` map from `bronze.kajabi_customers` (email → row), alongside the existing `customerMap` by ID.
2. For each contact being processed, look up `customerByEmail.get(resolvedEmail)` and extract the five profile fields from `customer.data.attributes`.
3. Include the five fields in each member object passed to `reprocess_members_atomic`.

The existing `customerMap` (by ID) is unchanged — it's still used for linking purchases. The new `customerByEmail` map is additive.

## Member Profile Page (`/members/[id]`)

### Query change
Add `photo_url, bio, instagram_url, facebook_url, twitter_url` to the `members` select.

### UI changes (visible to all logged-in members, not gated by `isSelf`)

**Header area** — replace the plain text name header with a flex row:
- Left: circular avatar (48×48px). If `photo_url` is set, renders `<img>` with `object-cover`. If null, renders initials (first letter of first + last name) on a colored background.
- Right: name + "Member since …" stacked as before.

**Bio** — if `bio` is non-null, a short paragraph rendered directly below the header, before the Community Stats card.

**Social links** — if any social URL is non-null, a small row of icon links (Twitter/X, Instagram, Facebook) rendered below the bio (or below the header if no bio). Each icon links to the URL in a new tab. Icons with null URLs are omitted entirely.

### No changes to `isSelf` blocks
The Account, Engagement, and Prickle History sections remain self-only.

## Error Handling

- `photo_url` pointing to a broken image: handled by `onError` on the `<img>` that swaps to the initials fallback.
- All five fields are optional; null values simply omit the corresponding UI element.

## Testing

No automated tests required for this feature. The fields are display-only, sourced from an existing Bronze table, and the processing logic is a straightforward map lookup added to an already-tested route.
