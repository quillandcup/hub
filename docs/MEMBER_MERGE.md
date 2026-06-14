# Member Merge

Merging combines two member records into one, transferring all associated data to the primary (kept) member and permanently deleting the secondary (duplicate).

## Entry Points

- **Individual merge** — "Merge" button on any member's detail page (`/admin/members/[id]`). Search for the duplicate to absorb.
- **Bulk merge** — select 2+ members on the members list (`/admin/members`) and click "Merge" in the selection bar.
- **Merge & Fix** — `/admin/hygiene/merge-fix` auto-detects potential duplicates by identical name or email and presents them as reviewable groups.

All three flows call the same API endpoint: `POST /api/admin/members/merge`.

## What Gets Transferred

| Table | Field | Behaviour |
|---|---|---|
| `prickle_attendance` | `member_id` | Reassigned to primary |
| `member_activities` | `member_id` | Reassigned to primary |
| `member_hiatus_history` | `member_id` | Reassigned to primary |
| `member_status_overrides` | `member_id` | Reassigned to primary |
| `prickles` | `host_id` | Reassigned to primary |
| `prickle_types` | `default_host_id` | Reassigned to primary |
| `ambiguous_zoom_names` | `resolved_member_id` | Reassigned to primary |
| `ambiguous_zoom_names` | `candidate_member_ids[]` | Secondary ID replaced in-place; deduplicated if primary already present |
| `member_name_aliases` | `member_id` | Non-conflicting aliases reassigned; conflicting aliases dropped; secondary's name added as a new alias |
| `member_email_aliases` | `alias_email` | Secondary email added as alias pointing to primary |
| `member_email_aliases` | `canonical_email` | Rows where secondary was the canonical email re-pointed to primary |
| `members` | `kajabi_id` | Copied to primary if primary is missing it; conflict noted if both differ |
| `members` | `stripe_customer_id` | Same as above |
| `members` | `user_id` | Same as above |
| `member_metrics` | `member_id` | Deleted (recomputed for primary on next metrics run) |
| `member_engagement` | `member_id` | Deleted (recomputed for primary on next metrics run) |
| `bronze.slack_users` | matched by email at runtime | Covered by the email alias added above |
| `bronze.kajabi_contacts` | matched by `kajabi_id` at runtime | Covered by the `kajabi_id` transfer above |
| `bronze.stripe_customers` | matched by `stripe_customer_id` at runtime | Covered by the `stripe_customer_id` transfer above |

## External ID Conflicts

When both members have **different non-null values** for `kajabi_id`, `stripe_customer_id`, or `user_id`, the primary's value is kept and the secondary's is discarded. The API returns a `conflicts` array describing each discarded value, and the merge modal surfaces this as an orange warning after the merge completes. In that case, verify in Kajabi or Stripe that the correct account is linked.

## Duplicate Detection (`detectDuplicates`)

The Merge & Fix page uses `lib/member-duplicates.ts` to detect candidates:

- **Same name** — normalized (lowercase, collapsed whitespace) name matches
- **Same email** — case-insensitive email matches

A pair is only reported once even if it matches on both criteria. The function is a pure utility; tests are in `tests/member-duplicates.test.ts`.

## Operation Order

The merge API (`app/api/admin/members/merge/route.ts`) runs in this order to avoid FK constraint violations:

1. Parallel: transfer all simple `member_id` / `host_id` / `default_host_id` FKs
2. Sequential: handle `member_name_aliases` (requires reading existing aliases first to detect conflicts)
3. Sequential: update `ambiguous_zoom_names.candidate_member_ids` arrays (requires fetch-then-update)
4. Parallel: upsert email alias, re-point canonical email aliases, patch primary's external IDs, delete derived records
5. Final: `DELETE` the secondary member row
