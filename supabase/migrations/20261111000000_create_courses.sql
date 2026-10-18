-- Courses in the Hub (see docs/COURSES.md): Bronze mirror of Kajabi's courses, the Silver
-- curriculum members see, and the Local tables the Hub owns (videos, access grants, progress,
-- watch segments). Schema only: the import, processing and media steps come after.
--
-- Bronze: upserted on Kajabi's ids, soft-deleted with deleted_at when a complete fetch no longer
-- returns the row. Silver: upserted on its source key with orphans removed (like prickles), so ids
-- and URLs stay stable. Local: never reprocessed.

------------------------------------------------------------------------------------------------
-- Bronze (raw Kajabi). Admins read, only the service role writes.
------------------------------------------------------------------------------------------------

CREATE TABLE bronze.kajabi_courses (
  kajabi_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  publishing_option TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE TABLE bronze.kajabi_course_modules (
  kajabi_id TEXT PRIMARY KEY,
  course_kajabi_id TEXT NOT NULL,
  -- Modules nest ("weeks" inside modules) through Kajabi's parent_module.
  parent_kajabi_id TEXT,
  position INTEGER,
  title TEXT NOT NULL,
  publishing_option TEXT,
  poster_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX kajabi_course_modules_course_idx ON bronze.kajabi_course_modules (course_kajabi_id);

CREATE TABLE bronze.kajabi_course_lessons (
  kajabi_id TEXT PRIMARY KEY,
  course_kajabi_id TEXT NOT NULL,
  module_kajabi_id TEXT,
  position INTEGER,
  title TEXT NOT NULL,
  publishing_option TEXT,
  -- From the API.
  video_duration_seconds INTEGER,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- From the admin-session content script (not in the API); null until it has run for the lesson.
  body_html TEXT,
  thumbnail_url TEXT,
  -- Kajabi's media id (and length) for the lesson's video.
  video_media_id TEXT,
  video_source JSONB,
  content_hash TEXT,
  content_fetched_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX kajabi_course_lessons_course_idx ON bronze.kajabi_course_lessons (course_kajabi_id);
CREATE INDEX kajabi_course_lessons_module_idx ON bronze.kajabi_course_lessons (module_kajabi_id);

CREATE TABLE bronze.kajabi_lesson_files (
  kajabi_id TEXT PRIMARY KEY,
  lesson_kajabi_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  source_url TEXT,
  content_type TEXT,
  size_bytes BIGINT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX kajabi_lesson_files_lesson_idx ON bronze.kajabi_lesson_files (lesson_kajabi_id);

-- Which Kajabi offers grant which course.
CREATE TABLE bronze.kajabi_course_offers (
  course_kajabi_id TEXT NOT NULL,
  offer_kajabi_id TEXT NOT NULL,
  offer_title TEXT,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (course_kajabi_id, offer_kajabi_id)
);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['kajabi_courses', 'kajabi_course_modules', 'kajabi_course_lessons',
                           'kajabi_lesson_files', 'kajabi_course_offers']
  LOOP
    EXECUTE format('ALTER TABLE bronze.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON bronze.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON bronze.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON bronze.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "Admins can read %s" ON bronze.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))', t, t);
    EXECUTE format('COMMENT ON TABLE bronze.%I IS %L', t, 'BRONZE: raw Kajabi course data (docs/COURSES.md).');
  END LOOP;
END $$;

------------------------------------------------------------------------------------------------
-- Local: videos (one row per Mux asset). Created before Silver, which points at it.
------------------------------------------------------------------------------------------------

CREATE TABLE public.videos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mux_asset_id TEXT UNIQUE,
  -- Signed playback policy: playback needs a token minted server-side after an access check.
  mux_playback_id TEXT,
  status TEXT NOT NULL DEFAULT 'preparing' CHECK (status IN ('preparing', 'ready', 'errored')),
  duration_seconds NUMERIC,
  -- Mux video_quality, set when the asset is created.
  quality TEXT NOT NULL DEFAULT 'plus' CHECK (quality IN ('basic', 'plus', 'premium')),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('kajabi', 'upload')),
  -- The Kajabi media id for source_kind 'kajabi'.
  source_key TEXT NOT NULL,
  -- Cheap change check, no download: media id, duration, Content-Length / ETag / Last-Modified.
  source_fingerprint TEXT,
  -- Computed while streaming to Mux; lets two media ids share one asset.
  source_sha256 TEXT,
  -- The picture itself has captions; track files then default to off.
  has_burned_in_captions BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_kind, source_key)
);
CREATE INDEX videos_source_sha256_idx ON public.videos (source_sha256) WHERE source_sha256 IS NOT NULL;
CREATE TRIGGER update_videos_updated_at BEFORE UPDATE ON public.videos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.videos IS
  'Local layer: one row per Mux asset. Local because uploading is an external side effect we must not repeat. Service role writes; admins read.';

CREATE TABLE public.video_text_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  -- captions and subtitles are timed text the player shows (attached to Mux); a transcript is
  -- text for search and the follow-along panel and is never attached to the player.
  kind TEXT NOT NULL CHECK (kind IN ('captions', 'subtitles', 'transcript')),
  language TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('descript', 'whisper', 'mux_auto', 'manual')),
  is_default BOOLEAN NOT NULL DEFAULT false,
  -- The .vtt in the private storage bucket; the source of truth for what Mux has.
  storage_path TEXT,
  mux_track_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX video_text_tracks_video_idx ON public.video_text_tracks (video_id);
CREATE TRIGGER update_video_text_tracks_updated_at BEFORE UPDATE ON public.video_text_tracks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.video_text_tracks IS
  'Local layer: caption, subtitle and transcript files per video. Service role writes; admins read.';

------------------------------------------------------------------------------------------------
-- Silver (what members see). Rebuilt from Bronze + Local by /api/process/courses.
------------------------------------------------------------------------------------------------

CREATE TABLE public.courses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  -- 'kajabi' rows are owned by the Kajabi reprocess; 'hub' rows (once the builder exists) never are.
  source TEXT NOT NULL DEFAULT 'kajabi' CHECK (source IN ('kajabi', 'hub')),
  source_key TEXT,
  -- Only evergreen is built; cohort leaves room for Self-Editing Academy and the 180.
  kind TEXT NOT NULL DEFAULT 'evergreen' CHECK (kind IN ('evergreen', 'cohort')),
  -- Whether the course includes membership lives on the program (programs.includes_membership).
  program_id UUID REFERENCES public.programs(id) ON DELETE SET NULL,
  -- How long access lasts from purchase; null = lifetime.
  access_duration INTERVAL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);
CREATE INDEX courses_program_idx ON public.courses (program_id);
CREATE TRIGGER update_courses_updated_at BEFORE UPDATE ON public.courses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.course_modules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  -- Weeks inside modules.
  parent_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  poster_url TEXT,
  -- 'open' or 'coming_soon' (locked/drip in Kajabi). Draft modules are not copied to Silver.
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'coming_soon')),
  source TEXT NOT NULL DEFAULT 'kajabi' CHECK (source IN ('kajabi', 'hub')),
  source_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);
CREATE INDEX course_modules_course_idx ON public.course_modules (course_id, position);
CREATE INDEX course_modules_parent_idx ON public.course_modules (parent_id);
CREATE TRIGGER update_course_modules_updated_at BEFORE UPDATE ON public.course_modules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TABLE public.course_lessons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  module_id UUID REFERENCES public.course_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  -- A lesson is never more visible than its module. Draft lessons are not copied to Silver.
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'coming_soon')),
  -- Sanitized on import with an allowlist; never rendered raw.
  body_html TEXT,
  thumbnail_url TEXT,
  video_id UUID REFERENCES public.videos(id) ON DELETE SET NULL,
  duration_seconds INTEGER,
  source TEXT NOT NULL DEFAULT 'kajabi' CHECK (source IN ('kajabi', 'hub')),
  source_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source, source_key)
);
CREATE INDEX course_lessons_course_idx ON public.course_lessons (course_id, position);
CREATE INDEX course_lessons_module_idx ON public.course_lessons (module_id);
CREATE INDEX course_lessons_video_idx ON public.course_lessons (video_id);
CREATE TRIGGER update_course_lessons_updated_at BEFORE UPDATE ON public.course_lessons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Who can open which course. Derived from active Kajabi purchases of the course's offers plus
-- course_access_grants, rebuilt on every member/purchase reprocess (a refund removes access).
CREATE TABLE public.course_access (
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL,
  -- starts_at + courses.access_duration; null = lifetime.
  ends_at TIMESTAMPTZ,
  origin TEXT NOT NULL CHECK (origin IN ('purchase', 'grant')),
  PRIMARY KEY (member_id, course_id)
);
CREATE INDEX course_access_course_idx ON public.course_access (course_id);

------------------------------------------------------------------------------------------------
-- Local (ours, never reprocessed)
------------------------------------------------------------------------------------------------

-- Comps and staff access. Admin-written (the app also audits changes).
CREATE TABLE public.course_access_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Null = no end, regardless of the course's access_duration.
  ends_at TIMESTAMPTZ,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, course_id),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX course_access_grants_course_idx ON public.course_access_grants (course_id);

-- PDFs and other downloads, copied into a private bucket and served by signed URL after an access check.
CREATE TABLE public.course_lesson_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  content_hash TEXT,
  storage_path TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX course_lesson_files_lesson_idx ON public.course_lesson_files (lesson_id);

CREATE TABLE public.lesson_progress (
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  lesson_id UUID NOT NULL REFERENCES public.course_lessons(id) ON DELETE CASCADE,
  completed_at TIMESTAMPTZ,
  last_position_seconds NUMERIC NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, lesson_id)
);
CREATE TRIGGER update_lesson_progress_updated_at BEFORE UPDATE ON public.lesson_progress
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- One row per continuous stretch watched. Append-only; not written in sudo.
CREATE TABLE public.video_watch_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  video_id UUID NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  session_id UUID NOT NULL,
  start_seconds NUMERIC NOT NULL CHECK (start_seconds >= 0),
  end_seconds NUMERIC NOT NULL CHECK (end_seconds >= start_seconds),
  playback_rate NUMERIC NOT NULL DEFAULT 1 CHECK (playback_rate > 0),
  -- Null = captions off.
  captions_language TEXT,
  -- Was the tab on screen (separates watching from playing in the background).
  visible BOOLEAN NOT NULL DEFAULT true,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX video_watch_segments_member_video_idx ON public.video_watch_segments (member_id, video_id);
CREATE INDEX video_watch_segments_video_idx ON public.video_watch_segments (video_id);

COMMENT ON TABLE public.video_watch_segments IS
  'Local layer: append-only, one row per continuous stretch a member watched. Drives resume, completion and admin stats. Not written in sudo.';

------------------------------------------------------------------------------------------------
-- RLS and grants
------------------------------------------------------------------------------------------------

-- Is the signed-in member allowed to open this course right now? SECURITY DEFINER so the content
-- policies below don't re-run course_access's own RLS per row.
CREATE OR REPLACE FUNCTION public.has_course_access(p_course_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.course_access ca
    WHERE ca.course_id = p_course_id
      AND ca.member_id = public.current_member_id()
      AND ca.starts_at <= now()
      AND (ca.ends_at IS NULL OR ca.ends_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_course_access(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_course_access(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.has_course_access(UUID) IS
  'True when the signed-in member has current (started, not ended) access to the course. Used by the course content RLS policies.';

-- Content: members with current access, and admins. A member whose access ended still sees the
-- course in /courses with their progress; the app reads that with the service role after its own check.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['courses', 'course_modules', 'course_lessons']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format(
      'CREATE POLICY "Members with access and admins read %s" ON public.%I FOR SELECT TO authenticated '
      'USING ((SELECT public.is_admin()) OR public.has_course_access(%s))',
      t, t, CASE t WHEN 'courses' THEN 'id' ELSE 'course_id' END);
  END LOOP;
END $$;

-- Members see their own access rows; admins see all. Written by the service role only.
ALTER TABLE public.course_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_access FROM anon, authenticated;
GRANT SELECT ON public.course_access TO authenticated;
GRANT ALL ON public.course_access TO service_role;
CREATE POLICY "Members read their own course access, admins all" ON public.course_access
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

ALTER TABLE public.course_access_grants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_access_grants FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.course_access_grants TO authenticated;
GRANT ALL ON public.course_access_grants TO service_role;
CREATE POLICY "Admins manage course access grants" ON public.course_access_grants
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

-- Videos are never public: no member policy at all. Playback links are minted server-side after
-- the access check, using the service role.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['videos', 'video_text_tracks']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('CREATE POLICY "Admins read %s" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))', t, t);
  END LOOP;
END $$;

-- Lesson downloads: readable like the lesson they belong to.
ALTER TABLE public.course_lesson_files ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.course_lesson_files FROM anon, authenticated;
GRANT SELECT ON public.course_lesson_files TO authenticated;
GRANT ALL ON public.course_lesson_files TO service_role;
CREATE POLICY "Members with access and admins read course_lesson_files" ON public.course_lesson_files
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_admin())
    OR EXISTS (
      SELECT 1 FROM public.course_lessons l
      WHERE l.id = course_lesson_files.lesson_id AND public.has_course_access(l.course_id)
    )
  );

-- Progress: the member's own, plus admins. The app makes it read-only in sudo.
ALTER TABLE public.lesson_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_progress FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lesson_progress TO authenticated;
GRANT ALL ON public.lesson_progress TO service_role;
CREATE POLICY "Members manage their own lesson_progress" ON public.lesson_progress
  FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

-- Watch segments: append-only, so members can add and read their own but never change them.
ALTER TABLE public.video_watch_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_watch_segments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.video_watch_segments TO authenticated;
GRANT ALL ON public.video_watch_segments TO service_role;
CREATE POLICY "Members read their own watch segments, admins all" ON public.video_watch_segments
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Members add their own watch segments" ON public.video_watch_segments
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()));
