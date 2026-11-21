set lock_timeout = '5s';

-- Hedgie Care: the contract step of 20270707000000_care_plans_per_member.sql. A care plan belongs to a member, not to a
-- channel (docs/product/HEDGIE_CARE.md), and since that migration nothing reads or writes care_engagements.channel: the production
-- code leaves it to its default, renew_care_engagement no longer carries it, and the (member_id, channel) index is gone
-- (checked read-only in production before writing this: no view, policy, trigger or function depends on the column; the
-- only dependents are its own CHECK and default, which go with it).
--
-- The column's CHECK (care_engagements_channel_check) is a column constraint, so it is dropped with the column; it needs no
-- statement, and no ban-drop-constraint ignore, of its own. The audit trigger and the updated_at trigger read the row as a
-- whole and never name the column. Rows already in the audit log keep their old `channel` value in the stored JSON: history.

-- Approved ban-drop-column ignore: the owner approved it (2026-11-14); PR #1264 stopped reading and writing the column and is deployed (in the production tag).
-- squawk-ignore ban-drop-column
ALTER TABLE public.care_engagements DROP COLUMN channel;
