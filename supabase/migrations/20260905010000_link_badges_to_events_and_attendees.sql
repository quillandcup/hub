-- Links retreat badge_types to their events row, gives events an attendee list, and makes
-- adding/removing an attendee automatically grant/revoke the linked badge -- replacing manual
-- awarding for these badges. See docs/TODO.md's "Multi-Product Support & Badges" section.
--
-- Also backfills events for the 12 retreat badge_types seeded in
-- 20260831130000_add_retreat_badge_types.sql (+ the 2 earlier ones renamed there), deriving
-- title/dates/attendees from member_badges -- the only place this history currently lives,
-- since the data script that originally awarded these badges was never committed (real member
-- data). Contains no PII itself: the DO block below is pure SQL that reads whatever
-- member_badges rows already exist wherever this runs, so it's a no-op on an empty database
-- (local/test) and only does real backfill work once applied to production.

ALTER TABLE badge_types ADD COLUMN event_id UUID REFERENCES events(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX idx_badge_types_event_id_unique ON badge_types(event_id) WHERE event_id IS NOT NULL;
COMMENT ON COLUMN badge_types.event_id IS
  'Optional link to the event this badge represents (e.g. a specific retreat). Manual awarding is disabled once set -- attendance on the event drives member_badges instead. One event per badge, enforced by the partial unique index.';

-- Nullable; set only on rows auto-granted via event attendance (a manually-awarded badge stays
-- NULL). Lets remove_event_attendee() find exactly the right row to delete, and lets the admin
-- UI distinguish "revoke here" from "manage attendance on the event instead".
ALTER TABLE member_badges ADD COLUMN event_id UUID REFERENCES events(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS event_attendees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, member_id)
);

CREATE INDEX idx_event_attendees_event_id ON event_attendees(event_id);
CREATE INDEX idx_event_attendees_member_id ON event_attendees(member_id);

ALTER TABLE event_attendees ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read event attendees"
  ON event_attendees FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert event attendees"
  ON event_attendees FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update event attendees"
  ON event_attendees FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete event attendees"
  ON event_attendees FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON event_attendees TO authenticated;
GRANT ALL ON event_attendees TO service_role;

COMMENT ON TABLE event_attendees IS 'LOCAL: which members attended which events. Admin-managed, enforced in the API route via requireAdmin (RLS is permissive, same shape as program_cohorts).';

-- Atomic multi-table operations (mirrors reprocess_members_atomic's use of a SQL function for
-- anything that must not partially apply). All SECURITY DEFINER + called only from
-- requireAdmin-gated API routes, same trust boundary as reprocess_members_atomic.

CREATE OR REPLACE FUNCTION add_event_attendee(p_event_id UUID, p_member_id UUID, p_admin_id UUID)
RETURNS void AS $$
DECLARE
  v_badge_type_id UUID;
  v_starts_at DATE;
  v_inserted UUID;
BEGIN
  INSERT INTO event_attendees (event_id, member_id, created_by)
  VALUES (p_event_id, p_member_id, p_admin_id)
  ON CONFLICT (event_id, member_id) DO NOTHING
  RETURNING event_id INTO v_inserted;

  IF v_inserted IS NULL THEN
    RETURN; -- already an attendee, nothing more to do
  END IF;

  SELECT bt.id, e.starts_at INTO v_badge_type_id, v_starts_at
  FROM events e
  LEFT JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NOT NULL THEN
    INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id, awarded_by)
    VALUES (p_member_id, v_badge_type_id, v_starts_at, p_event_id, p_admin_id);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION remove_event_attendee(p_event_id UUID, p_member_id UUID)
RETURNS void AS $$
BEGIN
  DELETE FROM event_attendees WHERE event_id = p_event_id AND member_id = p_member_id;
  DELETE FROM member_badges WHERE event_id = p_event_id AND member_id = p_member_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Backfills awards for attendees who were already on the event before a badge got linked to it
-- (e.g. attendance recorded first, badge created/linked afterward).
CREATE OR REPLACE FUNCTION sync_event_badge_awards(p_event_id UUID)
RETURNS void AS $$
DECLARE
  v_badge_type_id UUID;
  v_starts_at DATE;
BEGIN
  SELECT bt.id, e.starts_at INTO v_badge_type_id, v_starts_at
  FROM events e
  JOIN badge_types bt ON bt.event_id = e.id
  WHERE e.id = p_event_id;

  IF v_badge_type_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO member_badges (member_id, badge_type_id, occurred_at, event_id)
  SELECT ea.member_id, v_badge_type_id, v_starts_at, p_event_id
  FROM event_attendees ea
  WHERE ea.event_id = p_event_id
    AND NOT EXISTS (
      SELECT 1 FROM member_badges mb WHERE mb.event_id = p_event_id AND mb.member_id = ea.member_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- One-time backfill: an events row per retreat badge that's actually been awarded at least
-- once, derived entirely from existing member_badges rows. Idempotent (ON CONFLICT DO NOTHING /
-- re-derivable SELECTs), so safe to re-run or apply to a database that already has some of
-- these events.
DO $$
DECLARE
  r RECORD;
  v_event_id UUID;
  v_slug TEXT;
  v_event_type TEXT;
  v_location TEXT;
BEGIN
  FOR r IN
    SELECT bt.id AS badge_type_id, bt.key, bt.name,
           MIN(mb.occurred_at) AS starts_at, MAX(mb.occurred_at) AS ends_at
    FROM badge_types bt
    JOIN member_badges mb ON mb.badge_type_id = bt.id
    WHERE bt.category = 'retreat' AND bt.event_id IS NULL
    GROUP BY bt.id, bt.key, bt.name
  LOOP
    v_slug := replace(r.key, '_', '-');
    v_event_type := CASE WHEN r.key LIKE '%virtual%' THEN 'virtual_retreat' ELSE 'in_person_retreat' END;
    v_location := CASE
      WHEN v_event_type = 'virtual_retreat' THEN NULL
      ELSE NULLIF(trim(regexp_replace(regexp_replace(r.name, '^\d{4}\s+', ''), '\s+Retreat$', '')), '')
    END;

    INSERT INTO events (slug, title, event_type, location, starts_at, ends_at)
    VALUES (v_slug, r.name, v_event_type, v_location, r.starts_at, r.ends_at)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_event_id;

    IF v_event_id IS NULL THEN
      SELECT id INTO v_event_id FROM events WHERE slug = v_slug;
    END IF;

    UPDATE badge_types SET event_id = v_event_id WHERE id = r.badge_type_id;

    INSERT INTO event_attendees (event_id, member_id)
    SELECT v_event_id, mb.member_id FROM member_badges mb WHERE mb.badge_type_id = r.badge_type_id
    ON CONFLICT (event_id, member_id) DO NOTHING;

    UPDATE member_badges SET event_id = v_event_id WHERE badge_type_id = r.badge_type_id;
  END LOOP;
END $$;
