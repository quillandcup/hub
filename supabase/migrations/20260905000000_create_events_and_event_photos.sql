-- Events resource (Local layer): retreats and other in-person/virtual events, with
-- metadata (dates, location, agenda, results) and a photo gallery imported from
-- Google Photos via the Picker API (see lib/google-photos-picker/client.ts).
--
-- Retreats previously only existed as hardcoded badge_types rows
-- (20260831130000_add_retreat_badge_types.sql) -- this is deliberately separate
-- from badges (docs/TODO.md flags a generic `events` table as future work).

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('in_person_retreat', 'virtual_retreat', 'other')),
  location TEXT,
  starts_at DATE NOT NULL,
  ends_at DATE NOT NULL,
  focus TEXT,
  description TEXT,
  agenda TEXT,
  results TEXT,
  -- Kept as a "view full album on Google Photos" fallback link even after import.
  google_photos_album_url TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at >= starts_at)
);

CREATE TABLE IF NOT EXISTS event_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  -- PickedMediaItem.id from the Google Photos Picker API -- documented as "a
  -- persistent identifier that can be used between sessions to identify this
  -- media item", so it's safe as the re-sync dedup key (see import/commit route).
  google_media_item_id TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  mime_type TEXT,
  -- From the Picker item's createTime when present, for chronological gallery
  -- order; falls back to created_at (import order) otherwise.
  taken_at TIMESTAMPTZ,
  -- Soft-hide, not delete: re-syncing an album re-lists every picked item, and
  -- the dedup check only skips ids already present in this table. A hard
  -- delete would make a hidden photo look "new" again on the next sync.
  hidden_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, google_media_item_id)
);

CREATE INDEX idx_event_photos_event_id ON event_photos(event_id);

CREATE TRIGGER update_events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS: same permissive shape as programs/program_cohorts
-- (20260903000000_create_program_cohort_tracking.sql) -- admin-only writes are
-- enforced in the API routes via requireAdmin, not here. Members only need SELECT.
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read events"
  ON events FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert events"
  ON events FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update events"
  ON events FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete events"
  ON events FOR DELETE TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to read event photos"
  ON event_photos FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert event photos"
  ON event_photos FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update event photos"
  ON event_photos FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete event photos"
  ON event_photos FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON events TO authenticated;
GRANT ALL ON events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON event_photos TO authenticated;
GRANT ALL ON event_photos TO service_role;

COMMENT ON TABLE events IS 'LOCAL: Retreats and other events, with metadata and an imported photo gallery';
COMMENT ON TABLE event_photos IS 'LOCAL: Photos imported per-event from Google Photos via the Picker API';

-- Storage bucket for imported photos. Private (unlike book-covers): these
-- aren't meant to be publicly linkable off-site, so they're served through an
-- authenticated proxy route (app/api/events/[eventId]/photos/[photoId]) rather
-- than a public bucket URL or a signed URL (which is still a copyable link,
-- just time-limited).
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-photos', 'event-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated users can view event photos"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'event-photos');

CREATE POLICY "Admins can manage event photos"
    ON storage.objects FOR ALL
    USING (bucket_id = 'event-photos' AND is_admin());
