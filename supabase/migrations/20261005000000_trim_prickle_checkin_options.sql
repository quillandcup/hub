-- Trim the prickle check-in options (see lib/prickle-checkins.ts):
--   feelings: drop inspired, determined, curious, drained and scattered;
--   needs: fold gentle into company, rename unstick to unstuck.
-- Existing rows are remapped so past check-ins stay valid: inspired and determined count as
-- motivated, drained as tired, curious and scattered are dropped. A row left with no answer at
-- all is deleted (the table requires at least one). The key lists in the CHECKs must match
-- lib/prickle-checkins.ts (tests/lib/prickle-checkins.test.ts checks this file against it).

ALTER TABLE public.prickle_checkins
  DROP CONSTRAINT IF EXISTS prickle_checkins_feelings_before_check,
  DROP CONSTRAINT IF EXISTS prickle_checkins_feelings_after_check,
  DROP CONSTRAINT IF EXISTS prickle_checkins_need_check,
  DROP CONSTRAINT IF EXISTS prickle_checkins_check;

CREATE OR REPLACE FUNCTION pg_temp.remap_feelings(old_feelings TEXT[])
RETURNS TEXT[] LANGUAGE sql AS $$
  SELECT COALESCE(array_agg(f ORDER BY first_pos), '{}')
  FROM (
    SELECT f, MIN(pos) AS first_pos
    FROM (
      SELECT CASE v
               WHEN 'inspired' THEN 'motivated'
               WHEN 'determined' THEN 'motivated'
               WHEN 'drained' THEN 'tired'
               WHEN 'curious' THEN NULL
               WHEN 'scattered' THEN NULL
               ELSE v
             END AS f,
             pos
      FROM unnest(old_feelings) WITH ORDINALITY AS t(v, pos)
    ) mapped
    WHERE f IS NOT NULL
    GROUP BY f
  ) deduped
$$;

UPDATE public.prickle_checkins
SET feelings_before = pg_temp.remap_feelings(feelings_before),
    feelings_after = pg_temp.remap_feelings(feelings_after),
    need = CASE need WHEN 'gentle' THEN 'company' WHEN 'unstick' THEN 'unstuck' ELSE need END;

DELETE FROM public.prickle_checkins
WHERE cardinality(feelings_before) = 0 AND need IS NULL AND session_rating IS NULL
  AND cardinality(feelings_after) = 0;

ALTER TABLE public.prickle_checkins
  ADD CONSTRAINT prickle_checkins_feelings_before_check CHECK (
    cardinality(feelings_before) <= 2
    AND feelings_before <@ ARRAY[
      'motivated',
      'calm', 'content',
      'tired', 'meh',
      'stressed', 'anxious', 'overwhelmed', 'frustrated',
      'stuck', 'lonely'
    ]::TEXT[]
  ),
  ADD CONSTRAINT prickle_checkins_feelings_after_check CHECK (
    cardinality(feelings_after) <= 2
    AND feelings_after <@ ARRAY[
      'motivated',
      'calm', 'content',
      'tired', 'meh',
      'stressed', 'anxious', 'overwhelmed', 'frustrated',
      'stuck', 'lonely'
    ]::TEXT[]
  ),
  ADD CONSTRAINT prickle_checkins_need_check CHECK (
    need IN ('momentum', 'deep_focus', 'accountability', 'company', 'unstuck')
  ),
  ADD CONSTRAINT prickle_checkins_check CHECK (
    cardinality(feelings_before) > 0 OR need IS NOT NULL OR session_rating IS NOT NULL
    OR cardinality(feelings_after) > 0
  );
