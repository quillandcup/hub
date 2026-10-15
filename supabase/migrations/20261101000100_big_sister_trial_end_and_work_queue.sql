-- Follow-up to 20261101000000_big_sister_mentorships.sql.
--
-- 1. mentorships.trial_ends_on: when this trial ends, copied from the member's Stripe subscription
--    (trial_start / trial_end) when the match is made. Trials are mostly 7 days but have been a
--    month, so how long to wait before calling a trial "not converted" comes from the data
--    instead of a guess (lib/mentorship.ts deriveOutcome). NULL when Stripe has no trial for them.
-- 2. admin_work_queue_completions accepts the new 'big_sister' queue ("this new member needs a
--    big sister"), so staff can mark one done without matching (a direct sign-up, say).

ALTER TABLE mentorships ADD COLUMN trial_ends_on DATE;

COMMENT ON COLUMN mentorships.trial_ends_on IS
  'Last day of the trial, from the Stripe subscription''s trial_end when the match was made; NULL if Stripe had none.';

ALTER TABLE admin_work_queue_completions
  DROP CONSTRAINT IF EXISTS admin_work_queue_completions_queue_type_check;
ALTER TABLE admin_work_queue_completions
  ADD CONSTRAINT admin_work_queue_completions_queue_type_check
  CHECK (queue_type IN ('welcome_back', 'hedgieversary', 'hiatus_nudge', 'big_sister'));
