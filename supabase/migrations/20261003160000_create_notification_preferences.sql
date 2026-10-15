-- Notification preferences (Local layer, member-owned): which channels each kind of notification
-- reaches a member on. Kinds, channels and their defaults live in code
-- (lib/notifications/registry.ts); this table stores only a member's overrides, one row per
-- (member, kind, channel) they've changed. No row means the kind's default for that channel, so
-- new kinds and channels need no backfill, and a member who never opens settings gets the defaults.
--
-- kind/channel are free text rather than CHECKed: the registry is the source of truth, and
-- effectiveChannels() ignores overrides for ids it doesn't know (e.g. a retired channel), so adding
-- or retiring one never needs a migration.
--
-- Visibility: the member and admins (admins can see why someone isn't getting a DM). Writes are
-- owner-only. Sudo is an app-layer cookie invisible to Postgres (current_member_id() is the
-- admin's own member during sudo), so in sudo the app shows the member's settings read-only.

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind <> ''),
  channel TEXT NOT NULL CHECK (channel <> ''),
  enabled BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, kind, channel)
);

-- Senders load one kind for a batch of members.
CREATE INDEX IF NOT EXISTS notification_preferences_kind_idx ON public.notification_preferences (kind, member_id);

COMMENT ON TABLE public.notification_preferences IS
  'Local layer: a member''s per-kind, per-channel notification overrides of the defaults in lib/notifications/registry.ts. Readable by the member and admins; writable only by the member (read-only in sudo).';

DROP TRIGGER IF EXISTS update_notification_preferences_updated_at ON public.notification_preferences;
CREATE TRIGGER update_notification_preferences_updated_at
  BEFORE UPDATE ON public.notification_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members and admins read notification preferences" ON public.notification_preferences;
CREATE POLICY "Members and admins read notification preferences" ON public.notification_preferences
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members insert own notification preferences" ON public.notification_preferences;
CREATE POLICY "Members insert own notification preferences" ON public.notification_preferences
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Members update own notification preferences" ON public.notification_preferences
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

DROP POLICY IF EXISTS "Members delete own notification preferences" ON public.notification_preferences;
CREATE POLICY "Members delete own notification preferences" ON public.notification_preferences
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.notification_preferences FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_preferences TO authenticated;
GRANT ALL ON public.notification_preferences TO service_role;
