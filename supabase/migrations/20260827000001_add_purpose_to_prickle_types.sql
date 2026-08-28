-- Add a purpose classification to prickle types, used by the Prickle Picker
-- to hard-filter candidates (e.g. "I need non-writing work time"). This is
-- inherent to the activity itself (Monthly Goal Review is work regardless of
-- host), distinct from the per-host "vibe" tagging added in
-- 20260827000002_create_prickle_host_vibes.sql.

ALTER TABLE prickle_types ADD COLUMN purpose TEXT NOT NULL DEFAULT 'writing'
  CHECK (purpose IN ('writing', 'work', 'social', 'mixed'));

COMMENT ON COLUMN prickle_types.purpose IS
  'What this prickle type is primarily for: writing (default), work (on-topic structured group work, e.g. goal review or social media planning), social (hangout-focused), or mixed. Admin-editable best-guess classification, used by the Prickle Picker to filter.';

-- Whether a hedgie can reasonably bring an unrelated task (e.g. taxes,
-- marketing -- non-writing work) to this slot and just use it as protected
-- time, versus it being too structured/participatory or too chatty to zone
-- out during. This is orthogonal to `purpose`: Progress Prickle is
-- writing-purpose and BYO-task-friendly, but Sprint Prickle is also
-- writing-purpose and NOT friendly (it's an active word-war, not quiet time);
-- Monthly Goal Review is work-purpose but NOT friendly (it's a structured
-- workshop following the host's agenda, not open task time).
ALTER TABLE prickle_types ADD COLUMN solo_task_friendly BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN prickle_types.solo_task_friendly IS
  'Whether a hedgie can bring her own unrelated task (esp. non-writing work) to this slot and just use it as protected time. False for structured/participatory sessions (workshops, sprints, pitches, educational) and overly chatty ones (Craft & Chat) where zoning out on your own thing would not really work. Drives the Prickle Picker''s "non-writing work" filter -- independent of the purpose label above.';

-- Best-guess seed based on current type names/descriptions.
UPDATE prickle_types SET purpose = 'work'
  WHERE normalized_name IN ('monthly-goal-review', 'social-media-sunday');

UPDATE prickle_types SET purpose = 'social'
  WHERE normalized_name IN ('open-table', 'craft-chat', 'feel-good-friday');

-- Everything else (progress, plot-or-plan, sprint, heads-down, pitch,
-- midnight-crew, pomodoro, authorlife-heads-down, pop-up, educational, etc.)
-- keeps the 'writing' default.

-- Structured/participatory or overly chatty types aren't good places to
-- quietly do your own unrelated (esp. non-writing) task.
UPDATE prickle_types SET solo_task_friendly = false
  WHERE normalized_name IN (
    'monthly-goal-review', -- workshop-style, follows the host's agenda
    'social-media-sunday',  -- on-topic structured work session
    'educational',          -- structured/topic-focused
    'craft-chat',           -- very chatty by design
    'sprint',               -- active word-war, not quiet time
    'pitch',                -- active presenting/feedback exchange
    'members-only-pitch',   -- active presenting/feedback exchange
    'hedgies-on-first',     -- structured onboarding session
    'open-table',           -- social hangout
    'feel-good-friday'      -- social hangout
  );

-- Progress, Plot or Plan, Heads Down, Midnight Crew, Pomodoro, AuthorLife
-- Heads Down, and Pop-Up keep the `true` default -- unstructured protected
-- time, regardless of what you're using it for.
