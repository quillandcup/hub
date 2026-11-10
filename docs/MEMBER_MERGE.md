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
| `prickles` | `host` | Reassigned to primary |
| `prickle_schedules` | `host_id` | Reassigned to primary (it cascades, so an untransferred weekly schedule would be deleted) |
| `prickle_types` | `default_host_id` | Reassigned to primary |
| `member_program_enrollments` | `member_id` | Reassigned to primary; a cohort the primary is already enrolled in is left (and goes with the secondary) |
| `event_attendees` | `member_id` | Reassigned to primary with its ticket source and note (they are columns of the row); an event the primary already attends is skipped, and that row goes with the secondary (`EventRepository.moveAttendances`) |
| `member_badges` | `member_id` | Reassigned to primary; an event award the primary already has for the same event is skipped (it would show twice), hand-given awards all move (`BadgeRepository.moveAwards`) |
| `mentorships` | `mentor_member_id`, `new_member_id` | Big Sister matches, as the big sister or as the new member, reassigned to primary. A match between the two members stays behind (it would pair a member with themselves), and one that would be a second live match for the same arrival is left with the secondary (`MentorshipRepository.moveMemberRecords`) |
| `big_sister_volunteers` | `member_id` | The volunteer record is reassigned to primary (same method), unless the primary already has one |
| `ambiguous_zoom_names` | `resolved_member_id` | Reassigned to primary |
| `ambiguous_zoom_names` | `candidate_member_ids[]` | Secondary ID replaced in-place; deduplicated if primary already present |
| `member_name_aliases` | `member_id` | Non-conflicting aliases reassigned; conflicting aliases dropped; secondary's name added as a new alias |
| `member_email_aliases` | `member_id` | Reassigned to primary (before the delete: aliases cascade with their member) |
| `member_email_aliases` | `alias_email` | Secondary email added as an alias of the primary |
| `members` | `kajabi_id` | Copied to primary if primary is missing it; conflict noted if both differ |
| `members` | `stripe_customer_id` | Same as above |
| `members` | `user_id` | Same as above |
| `member_metrics` | `member_id` | Deleted (recomputed for primary on next metrics run) |
| `member_engagement` | `member_id` | Deleted (recomputed for primary on next metrics run) |
| `bronze.slack_users` | matched by email at runtime | Covered by the email alias added above |
| `bronze.kajabi_contacts` | matched by `kajabi_id` at runtime | Covered by the `kajabi_id` transfer above |
| `bronze.stripe_customers` | matched by `stripe_customer_id` at runtime | Covered by the `stripe_customer_id` transfer above |

Every other table that references `members` is **not moved**: it cascades on delete and its rows go with the secondary. The list is `NOT_MOVED` in `lib/member-merge-coverage.ts` and the gap is tracked in `docs/TODO.md` ("Member merge drops most of a member's data").

## What the Dialog Shows

Once a duplicate is chosen, the merge dialogs (individual and bulk, which the Merge & Fix page also opens for a group) show **What <duplicate> has**: the number of rows the duplicate owns in each table that references `members`, so an admin sees before the merge, which cannot be undone, what would be lost. Rows the merge does not move are listed in a red block, "Will be deleted, not moved"; rows it moves are listed quietly under "Moves to <kept member>"; if there are none of the first kind it says "Nothing here would be lost". It is information only: the merge button never waits for it, and a failed count shows a note, not a block. The duplicate is shown by display name with the legal name beside it. (The Merge & Fix page's "Merge All" button has no dialog and shows nothing.)

How it works:

- `GET /api/admin/members/[id]/owned-data` (admin only; 400 for a bad id, 404 for an unknown member) returns `{ entries: [{ table, label, count, fate }] }`, `fate` being `moved` or `lost`.
- The counts come from `MemberRepository.ownedRowCounts`, which calls the admin-only SQL function `member_owned_row_counts(p_member_id)`. It finds the tables from the foreign keys to `members` in `pg_constraint` (single-column keys in `public`), so a new table is counted without a code change. Zero counts, `member_directory` and the derived stats (`member_metrics`, `member_engagement`) are left out. The in-memory twin counts only name and email aliases.
- `lib/member-merge-coverage.ts` holds the classification (`MOVED`, `DERIVED`, `NOT_MOVED`) and a short label per table (a table without one shows its own name; a table nobody classified is reported as lost). The route reads it and `tests/lib/member-merge-coverage.test.ts` checks it against the generated types, so a new table that references `members` fails the test until it is classified, and the dialog cannot drift from the guard. When a table starts being moved by the merge, move its name from `NOT_MOVED` to `MOVED` there.

## External ID Conflicts

When both members have **different non-null values** for `kajabi_id`, `stripe_customer_id`, or `user_id`, the primary's value is kept and the secondary's is discarded. The API returns a `conflicts` array describing each discarded value, and the merge modal surfaces this as an orange warning after the merge completes. In that case, verify in Kajabi or Stripe that the correct account is linked.

## Durability Across Reimports

The merge is **durable across Kajabi/Stripe/Slack reimports** — the secondary is not re-created.

How it holds:

- **Kajabi contact re-import**: `process/members` runs `resolveEmail()` before building the member list. The secondary's email resolves to the primary's canonical email via `member_email_aliases`, so both Kajabi contacts collapse to a single member row. When a collision occurs, `process/members` prefers the contact whose original email is the canonical one (i.e. the primary), so the primary's `name`, `kajabi_id`, and status are never overwritten by the secondary's stale Kajabi data.
- **Stripe re-import**: `stripe_customers` has no FK to `members`; the link is `stripe_customer_id` on the member row, which was preserved (or transferred) during merge.
- **Slack**: `bronze.slack_users` is matched by email at activity-processing time. The email alias causes Slack messages from the secondary's email to be attributed to the primary.
- **Zoom**: Same — name/email matching uses `member_name_aliases` and `member_email_aliases`, both of which were updated during the merge.

The one thing a reimport **cannot** recover is a discarded external ID conflict (e.g. two different `kajabi_id` values where the secondary's was dropped). That information is gone from the Silver layer once the secondary is deleted.

## Duplicate Detection (`detectDuplicates`)

The Merge & Fix page uses `lib/member-duplicates.ts` to detect candidates:

- **Same name** — normalized (lowercase, collapsed whitespace) name matches
- **Same email** — case-insensitive email matches

A pair is only reported once even if it matches on both criteria. The function is a pure utility; tests are in `tests/member-duplicates.test.ts`.

## Operation Order

The merge API (`app/api/admin/members/merge/route.ts`) runs in this order to avoid FK constraint violations:

1. Parallel: transfer the simple `member_id` / `host` / `host_id` / `default_host_id` FKs, event attendances, badges, Big Sister records, and the Zoom name candidates
2. Sequential: handle `member_name_aliases` (requires reading existing aliases first to detect conflicts)
3. Sequential: move program enrollments (a cohort the primary is already in would collide), then the email aliases (`ambiguous_zoom_names.candidate_member_ids` is repointed in step 1)
4. Parallel: upsert email alias, re-point canonical email aliases, patch primary's external IDs, delete derived records
5. Final: `DELETE` the secondary member row
