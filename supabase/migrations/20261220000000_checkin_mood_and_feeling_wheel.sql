-- Reshape the prickle check-in questions (rationale: docs/CHECKINS.md; option keys:
-- lib/prickle-checkins.ts).
--   before: mood on two labeled 1-5 scales (pleasant_before, energy_before), optionally the feeling
--           named on the Feeling Wheel (emotion_before), and the intention (need, unchanged).
--   after:  did they get what they came for (intention_met, 1-5), the same two mood scales
--           (pleasant_after, energy_after) and optionally the feeling (emotion_after).
-- The hand-picked feelings lists and the 1-5 "how did it go" rating are dropped. Existing
-- check-ins are carried over to the new questions:
--   - need is unchanged;
--   - each feelings list's first feeling becomes the wheel word: the same word when it's on the
--     wheel, else its first suggestion (LEGACY_FEELING_TO_EMOTION in lib/prickle-checkins.ts;
--     tests/lib/prickle-checkins.test.ts checks this file's mapping against it);
--   - the 1-5 rating ("Rough" .. "Great") becomes intention_met ("Not at all" .. "Completely"), a
--     stand-in: both are 5-point session outcomes;
--   - the mood scales stay empty: they're new questions, and estimating them would put invented
--     values into the before/after measurement.
-- The conversion runs with the table's triggers off, so it neither logs "updated check-in"
-- activities for members nor touches updated_at.
-- The emotion key lists must match EMOTION_KEYS in lib/prickle-checkins.ts
-- (tests/lib/prickle-checkins.test.ts checks this file against it).

ALTER TABLE public.prickle_checkins DISABLE TRIGGER USER;

ALTER TABLE public.prickle_checkins
  DROP CONSTRAINT IF EXISTS prickle_checkins_check,
  ADD COLUMN pleasant_before SMALLINT CONSTRAINT prickle_checkins_pleasant_before_check CHECK (pleasant_before BETWEEN 1 AND 5),
  ADD COLUMN energy_before SMALLINT CONSTRAINT prickle_checkins_energy_before_check CHECK (energy_before BETWEEN 1 AND 5),
  ADD COLUMN emotion_before TEXT,
  ADD COLUMN intention_met SMALLINT CONSTRAINT prickle_checkins_intention_met_check CHECK (intention_met BETWEEN 1 AND 5),
  ADD COLUMN pleasant_after SMALLINT CONSTRAINT prickle_checkins_pleasant_after_check CHECK (pleasant_after BETWEEN 1 AND 5),
  ADD COLUMN energy_after SMALLINT CONSTRAINT prickle_checkins_energy_after_check CHECK (energy_after BETWEEN 1 AND 5),
  ADD COLUMN emotion_after TEXT;

CREATE OR REPLACE FUNCTION pg_temp.legacy_feeling_to_emotion(feeling TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE feeling
    WHEN 'motivated' THEN 'energetic'
    WHEN 'calm' THEN 'serene'
    WHEN 'content' THEN 'content'
    WHEN 'tired' THEN 'sleepy'
    WHEN 'meh' THEN 'apathetic'
    WHEN 'stressed' THEN 'anxious'
    WHEN 'anxious' THEN 'anxious'
    WHEN 'overwhelmed' THEN 'helpless'
    WHEN 'frustrated' THEN 'frustrated'
    WHEN 'stuck' THEN 'frustrated'
    WHEN 'lonely' THEN 'lonely'
  END
$$;

UPDATE public.prickle_checkins
SET emotion_before = pg_temp.legacy_feeling_to_emotion(feelings_before[1]),
    emotion_after = pg_temp.legacy_feeling_to_emotion(feelings_after[1]),
    intention_met = session_rating;

-- A row left with no answer at all can't satisfy the new CHECK; none is expected.
DELETE FROM public.prickle_checkins
WHERE num_nonnulls(pleasant_before, energy_before, emotion_before, need,
                   intention_met, pleasant_after, energy_after, emotion_after) = 0;

ALTER TABLE public.prickle_checkins
  DROP CONSTRAINT IF EXISTS prickle_checkins_feelings_before_check,
  DROP CONSTRAINT IF EXISTS prickle_checkins_feelings_after_check,
  DROP COLUMN feelings_before,
  DROP COLUMN feelings_after,
  DROP COLUMN session_rating;

ALTER TABLE public.prickle_checkins
  ADD CONSTRAINT prickle_checkins_emotion_before_check CHECK (
    emotion_before IN (
      'mad', 'scared', 'joyful', 'powerful', 'peaceful', 'sad',
      'hurt', 'hostile', 'angry', 'rage', 'hateful', 'critical',
      'rejected', 'confused', 'helpless', 'submissive', 'insecure', 'anxious',
      'excited', 'vibrant', 'energetic', 'playful', 'creative', 'aware',
      'proud', 'respected', 'appreciated', 'hopeful', 'important', 'faithful',
      'nurturing', 'trusting', 'loving', 'intimate', 'thoughtful', 'content',
      'sleepy', 'bored', 'lonely', 'depressed', 'ashamed', 'guilty',
      'jealous', 'selfish', 'frustrated', 'furious', 'irritated', 'skeptical',
      'bewildered', 'discouraged', 'insignificant', 'weak', 'foolish', 'embarrassed',
      'daring', 'fascinating', 'stimulating', 'amused', 'extravagant', 'delightful',
      'cheerful', 'satisfied', 'valuable', 'worthwhile', 'intelligent', 'confident',
      'thankful', 'sentimental', 'serene', 'responsive', 'relaxed', 'pensive',
      'apathetic', 'inferior', 'inadequate', 'miserable', 'stupid', 'bashful'
    )
  ),
  ADD CONSTRAINT prickle_checkins_emotion_after_check CHECK (
    emotion_after IN (
      'mad', 'scared', 'joyful', 'powerful', 'peaceful', 'sad',
      'hurt', 'hostile', 'angry', 'rage', 'hateful', 'critical',
      'rejected', 'confused', 'helpless', 'submissive', 'insecure', 'anxious',
      'excited', 'vibrant', 'energetic', 'playful', 'creative', 'aware',
      'proud', 'respected', 'appreciated', 'hopeful', 'important', 'faithful',
      'nurturing', 'trusting', 'loving', 'intimate', 'thoughtful', 'content',
      'sleepy', 'bored', 'lonely', 'depressed', 'ashamed', 'guilty',
      'jealous', 'selfish', 'frustrated', 'furious', 'irritated', 'skeptical',
      'bewildered', 'discouraged', 'insignificant', 'weak', 'foolish', 'embarrassed',
      'daring', 'fascinating', 'stimulating', 'amused', 'extravagant', 'delightful',
      'cheerful', 'satisfied', 'valuable', 'worthwhile', 'intelligent', 'confident',
      'thankful', 'sentimental', 'serene', 'responsive', 'relaxed', 'pensive',
      'apathetic', 'inferior', 'inadequate', 'miserable', 'stupid', 'bashful'
    )
  ),
  -- At least one answer: clearing every answer soft-deletes the row instead.
  ADD CONSTRAINT prickle_checkins_check CHECK (
    num_nonnulls(pleasant_before, energy_before, emotion_before, need,
                 intention_met, pleasant_after, energy_after, emotion_after) > 0
  );

COMMENT ON TABLE public.prickle_checkins IS
  'Local layer: a member''s check-in for a prickle (mood before/after, named emotion, intention, whether they got what they came for). Readable by the member and admins; writable only by the member (read-only in sudo).';
COMMENT ON COLUMN public.prickle_checkins.pleasant_before IS 'Check-in: overall, how they feel, 1 (very bad) to 5 (very good).';
COMMENT ON COLUMN public.prickle_checkins.energy_before IS 'Check-in: how much energy they have, 1 (very low) to 5 (very high).';
COMMENT ON COLUMN public.prickle_checkins.emotion_before IS 'Check-in, optional: the feeling named on the Feeling Wheel (Willcox, 1982; a core, middle-ring or outer-ring key).';
COMMENT ON COLUMN public.prickle_checkins.intention_met IS 'Check-out: did they get what they came for (the need), 1 (not at all) to 5 (completely).';
COMMENT ON COLUMN public.prickle_checkins.pleasant_after IS 'Check-out: same scale as pleasant_before.';
COMMENT ON COLUMN public.prickle_checkins.energy_after IS 'Check-out: same scale as energy_before.';
COMMENT ON COLUMN public.prickle_checkins.emotion_after IS 'Check-out, optional: same as emotion_before.';

-- The activity-log trigger (latest definition: 20261006120000) read the dropped columns. Same
-- logic over the new answers: a half counts as answered once any of its answers is.
CREATE OR REPLACE FUNCTION prickle_checkins_log_activity() RETURNS trigger AS $$
DECLARE
    half      text;
    type_name text;
    verb      text;
    kind      text;
    cur       boolean;
    was       boolean;
    changed   boolean;
    new_in    boolean := NEW.deleted_at IS NULL AND num_nonnulls(NEW.pleasant_before, NEW.energy_before, NEW.emotion_before, NEW.need) > 0;
    new_out   boolean := NEW.deleted_at IS NULL AND num_nonnulls(NEW.intention_met, NEW.pleasant_after, NEW.energy_after, NEW.emotion_after) > 0;
    old_in    boolean := false;
    old_out   boolean := false;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        old_in  := OLD.deleted_at IS NULL AND num_nonnulls(OLD.pleasant_before, OLD.energy_before, OLD.emotion_before, OLD.need) > 0;
        old_out := OLD.deleted_at IS NULL AND num_nonnulls(OLD.intention_met, OLD.pleasant_after, OLD.energy_after, OLD.emotion_after) > 0;
    END IF;

    SELECT pt.name INTO type_name
      FROM prickles p LEFT JOIN prickle_types pt ON pt.id = p.type_id WHERE p.id = NEW.prickle_id;

    FOREACH half IN ARRAY ARRAY['checkin', 'checkout'] LOOP
        cur := CASE half WHEN 'checkin' THEN new_in ELSE new_out END;
        was := CASE half WHEN 'checkin' THEN old_in ELSE old_out END;
        changed := TG_OP = 'UPDATE' AND CASE half
            WHEN 'checkin'  THEN (NEW.pleasant_before, NEW.energy_before, NEW.emotion_before, NEW.need)
                                 IS DISTINCT FROM (OLD.pleasant_before, OLD.energy_before, OLD.emotion_before, OLD.need)
            ELSE                 (NEW.intention_met, NEW.pleasant_after, NEW.energy_after, NEW.emotion_after)
                                 IS DISTINCT FROM (OLD.intention_met, OLD.pleasant_after, OLD.energy_after, OLD.emotion_after)
        END;

        IF cur AND NOT was THEN
            kind := 'prickle_' || half;
            verb := CASE half WHEN 'checkin' THEN 'Checked in to ' ELSE 'Checked out of ' END;
        ELSIF was AND NOT cur THEN
            kind := 'prickle_' || half || '_cleared';
            verb := CASE half WHEN 'checkin' THEN 'Cleared check-in for ' ELSE 'Cleared check-out for ' END;
        ELSIF cur AND was AND changed THEN
            -- Folds a multi-step save (Slack answers one field at a time) into the row it continues.
            CONTINUE WHEN EXISTS (
                SELECT 1 FROM member_activities
                 WHERE related_id = NEW.id::text AND source = 'prickle_checkins'
                   AND activity_type LIKE 'prickle_' || half || '%'
                   AND occurred_at > now() - interval '10 minutes');
            kind := 'prickle_' || half || '_updated';
            verb := CASE half WHEN 'checkin' THEN 'Updated check-in for ' ELSE 'Updated check-out for ' END;
        ELSE
            CONTINUE;
        END IF;

        INSERT INTO member_activities (member_id, activity_type, activity_category, title, prickle_id,
                                       related_id, engagement_value, occurred_at, source, actor_kind, data)
        VALUES (NEW.member_id, kind, 'event', verb || COALESCE(type_name, 'a prickle'),
                NEW.prickle_id, NEW.id::text, 0, now(), 'prickle_checkins', 'member',
                jsonb_build_object('via', NEW.saved_via));
    END LOOP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

ALTER TABLE public.prickle_checkins ENABLE TRIGGER USER;
