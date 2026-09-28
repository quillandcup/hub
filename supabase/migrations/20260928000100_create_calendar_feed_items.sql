-- Things a member added to their personal calendar feed by hand, beyond what it includes on its
-- own (prickles they host, prickles they've committed to). See 20260928000000_create_calendar_feed_tokens.sql
-- and lib/calendar-feed.ts. Three kinds:
--
--   prickle  one occurrence ("just the next one"), e.g. an Educational Prickle
--   slot     a recurring weekly slot, ongoing ("every week") -- like a commitment with no window
--            and no kept/missed tracking
--   event    a retreat or other event (events table)
--
-- Like prickle_commitments, prickles are identified by type + time, never prickles(id): prickles
-- are DELETE+INSERT reprocessed, so their ids aren't stable. A 'prickle' item stores the
-- occurrence's type + start instant; a 'slot' item stores the same slot identity as
-- prickle_commitment_slots (type + weekday + local start time + timezone).
--
-- LOCAL layer: members own this data (normal CRUD, never reprocessed).
CREATE TABLE calendar_feed_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('prickle', 'slot', 'event')),

  type_id UUID REFERENCES prickle_types(id) ON DELETE CASCADE, -- prickle, slot
  start_time TIMESTAMPTZ,                                       -- prickle
  day_of_week SMALLINT CHECK (day_of_week BETWEEN 0 AND 6),     -- slot (0=Sunday, as elsewhere)
  start_time_local TIME,                                        -- slot
  timezone TEXT,                                                -- slot
  event_id UUID REFERENCES events(id) ON DELETE CASCADE,        -- event

  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL, -- the real user (an admin, under sudo)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CHECK (
    CASE kind
      WHEN 'prickle' THEN type_id IS NOT NULL AND start_time IS NOT NULL
        AND day_of_week IS NULL AND start_time_local IS NULL AND timezone IS NULL AND event_id IS NULL
      WHEN 'slot' THEN type_id IS NOT NULL AND day_of_week IS NOT NULL AND start_time_local IS NOT NULL
        AND timezone IS NOT NULL AND start_time IS NULL AND event_id IS NULL
      WHEN 'event' THEN event_id IS NOT NULL
        AND type_id IS NULL AND start_time IS NULL AND day_of_week IS NULL AND start_time_local IS NULL AND timezone IS NULL
    END
  )
);

-- One of each thing per member. Partial indexes, so the app inserts and treats 23505 as "already
-- added" (PostgREST upsert can't target a partial unique index).
CREATE UNIQUE INDEX uq_calendar_feed_items_prickle
  ON calendar_feed_items(member_id, type_id, start_time) WHERE kind = 'prickle';
CREATE UNIQUE INDEX uq_calendar_feed_items_slot
  ON calendar_feed_items(member_id, type_id, day_of_week, start_time_local, timezone) WHERE kind = 'slot';
CREATE UNIQUE INDEX uq_calendar_feed_items_event
  ON calendar_feed_items(member_id, event_id) WHERE kind = 'event';
CREATE INDEX idx_calendar_feed_items_type_id ON calendar_feed_items(type_id);
CREATE INDEX idx_calendar_feed_items_event_id ON calendar_feed_items(event_id);

COMMENT ON TABLE calendar_feed_items IS
  'LOCAL: prickles (one occurrence, or a weekly slot) and events a member added to their personal
   calendar feed, on top of the hosted and committed prickles it includes automatically.
   Prickles are identified by type + time, not prickles(id), which reprocessing changes.';

ALTER TABLE calendar_feed_items ENABLE ROW LEVEL SECURITY;

-- Owner via current_member_id(), admin via is_admin() (covers sudo). Items are added and removed,
-- never edited, so there's no UPDATE policy.
CREATE POLICY "View own calendar feed items, admins view all" ON calendar_feed_items
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Add own calendar feed items, admins add any" ON calendar_feed_items
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Remove own calendar feed items, admins remove any" ON calendar_feed_items
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
