-- A member can skip a check-in or check-out question: "I'd rather not say" is an answer of its
-- own, so a half with skipped questions counts as done and stops being offered.
--   skipped: the questions skipped, by answer column name (the same keys as the columns; the list
--            must match CHECKIN_FIELDS in lib/prickle-checkins.ts, which tests/lib/prickle-checkins.test.ts
--            checks against this file). A question is never both answered and skipped: the app
--            clears one when the other is set.
-- The "at least one answer" rule now counts skips too, since a row can hold only skips. The old
-- rule is replaced by a looser one, so code still running during the deploy keeps working: it
-- always saves at least one answer.
set lock_timeout = '5s';

ALTER TABLE public.prickle_checkins
  ADD COLUMN skipped TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.prickle_checkins
  ADD CONSTRAINT prickle_checkins_skipped_check CHECK (
    skipped <@ ARRAY[
      'pleasant_before', 'energy_before', 'emotion_before', 'need',
      'intention_met', 'pleasant_after', 'energy_after', 'emotion_after'
    ]::text[]
  );

-- Approved ban-drop-constraint ignore: the user approved replacing this CHECK with one that also counts skips; it only loosens the rule.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.prickle_checkins DROP CONSTRAINT prickle_checkins_check;

ALTER TABLE public.prickle_checkins
  ADD CONSTRAINT prickle_checkins_check CHECK (
    num_nonnulls(pleasant_before, energy_before, emotion_before, need,
                 intention_met, pleasant_after, energy_after, emotion_after) > 0
    OR cardinality(skipped) > 0
  );

COMMENT ON COLUMN public.prickle_checkins.skipped IS 'Check-in and check-out: the questions the member skipped, by answer column name. Never also answered.';
