---
paths:
  - "src/app/api/process/**"
  - "src/app/api/import/**"
  - "src/app/api/reconcile/**"
  - "src/app/api/webhooks/**"
  - "supabase/migrations/**"
  - "src/lib/data/**"
  - "tests/api/**"
---

## Data Architecture

**Bronze Layer** (raw imports from external systems):
- `calendar_events`, `zoom_attendees`, `zoom_meetings`, `kajabi_members`, `subscription_history`, `slack_messages`, `slack_reactions`, `slack_channels` (channels and, with `is_mpim`, group DMs the bot is in), `slack_users`, `slack_channel_members` (who is in each conversation now; `left_at` is when they last left), `slack_channel_member_events` (append-only history of joins and leaves, from Slack's join/leave notices, webhook events and the member list; read it as periods through the `slack_channel_membership_periods` view), `slack_custom_emoji` (`deleted_at` soft delete), `slack_files` (files on messages and the path of our copy in the private `slack-files` bucket; service role only), `resend_events` (email events from Resend: sent, delivered, opened, clicked, bounced...; append-only, service role only, written by `/api/webhooks/resend` and the nightly `/api/reconcile/email`; the member timeline rows, `member_activities` with source `resend`, are rebuilt from it one email at a time; `ResendEventRepository`; see `docs/architecture/EMAIL_TIMELINE.md`)
- `stripe_invoices` and `stripe_charges` (who was billed what and when: amounts in cents, status, period, paid date, the failure code; no raw record, card details or customer email or name; service role only; `BillingRepository`; pull import in the manual Stripe import and the nightly `/api/reconcile/stripe-billing`, upsert on Stripe's id; see `src/lib/stripe/billing-import.ts`; the same nightly job and manual import also fill `stripe_customers`, `stripe_products` and `stripe_subscriptions` first, through `src/lib/stripe/core-import.ts`: upsert only, nothing removed, and each step runs even if the other fails)
- **Slack content is service role only**: `slack_messages` (text, files, raw payload) and `slack_files` can't be read by admins. Admin pages read `bronze.slack_messages_meta` (who, where, when, thread shape, `has_files`; no content; a `security_invoker` view over column grants on `slack_messages`, so its metadata columns need a `GRANT SELECT (col)` when added); code that needs the text runs server-side with the service role after checking the caller. `raw_payload` on `slack_users`, `slack_channels`, `slack_reactions` and `slack_channel_member_events` is hidden the same way with column grants, so `select("*")` on those fails for a signed-in user, and a column added to one of them needs its own `GRANT SELECT (col) ... TO authenticated` (`slack_content_privacy.test.sql` fails if one is missed).
- **Direct messages with staff are not special in chat** (decided 2026-11-12): no chat policy treats a DM with a staff member differently; it stays break-glass only. The one exception lives in Hedgie Care: the messages of a member's tracked one-on-one DM sent inside the windows of that member's care plans are shown in full to admins and community managers (`src/lib/care-messages.ts`, read with the service role after `requireStaffAction()` and `care.write`, with an audit entry and a note in Hub Chat; `docs/product/HEDGIE_CARE.md`, "Plan messages"). "A staff member" has one definition, `staff_member_ids()` in the database, read in TypeScript only through `StaffRepository.memberIds()` (the `staff` roster plus the members behind admin, assistant and community manager accounts); do not work it out again, and do not confuse it with who may read (admins and community managers only). `/privacy` ("Messages in a Hedgie Care plan") and `CarePlanNotice` say it: change them with the code.
- **Pattern**: UPSERT on natural keys for idempotency

**Local Layer** (operational data owned by this app):
- The tables are catalogued, with what each holds and who can read it, in `docs/architecture/LOCAL_LAYER_TABLES.md`: read a table's entry before changing how it is written or read. Members' own business resources (writing projects and goals, books, awards) soft delete, see below; private notes, hand-added calendar items and starting balances stay hard deletes.
- **Pattern**: Normal CRUD operations (INSERT, UPDATE, DELETE)
- **NOT reprocessed** - these tables ARE the source of truth

**Silver Layer** (canonical state, computed from Bronze + Local):
- `members`, `prickles`, `attendance`, `member_activities`
- **Pattern**: `prickles` UPSERT on their source key (`calendar_event_id` for calendar prickles, `zoom_meeting_uuid` and start time for PUPs: a PUP whose end moves keeps its id, one whose start moves is a new prickle) and DELETE orphans whose source is gone, so **prickle ids — and `/prickles/<id>` URLs — are stable** across reprocessing (safe to reference; add `ON DELETE CASCADE`/`SET NULL` for the rare real delete); DELETE + INSERT for `attendance`; `members` uses a custom atomic upsert (see below) to preserve historical attendance via the `ON DELETE CASCADE` FK; `member_activities` uses two patterns depending on source — DELETE+INSERT by `source` + date range for reprocessable mirrors (Slack, one week per `reprocess_slack_activities_atomic` call because rewriting 90 days in one statement ran past the 8s statement timeout; prickle attendance, mirrored atomically inside `reprocess_prickle_attendance_atomic`), and a best-effort single insert alongside the primary action for append-only sources (writing-progress, outreach touches, logins) that are never reprocessed. See `docs/architecture/ACTIVITY_AND_AUDIT_LOG.md`.

**Gold Layer** (aggregated views):
- Currently computed on-demand in dashboard queries
