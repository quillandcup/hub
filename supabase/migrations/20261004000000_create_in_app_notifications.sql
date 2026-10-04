-- In-app notifications (Local layer): what the "In the Hub" channel (lib/channels/in-app.ts) has
-- sent a member. Every one is listed under the bell in the member header (unread ones counted);
-- a time-sensitive one also shows as a banner under the header while it's unread and inside its
-- window: from banner_from (NULL = from when it was sent) until banner_until (NULL = never a
-- banner). Server-written only, through createNotifier (lib/notifications/notify.ts).
--
-- read_at is set when the member dismisses the banner or opens the bell, or when the feature
-- resolves it because it's been dealt with (e.g. a check-in once the member has checked in).
-- expires_at drops it from the list altogether once it's no longer worth showing.
--
-- kind is the notification kind (lib/notifications/registry.ts) and ref what it's about (e.g. a
-- prickle id), so a feature can resolve its own; both free text, like notification_preferences,
-- since the registry is the source of truth. url is a Hub path.
--
-- Visibility: the member and admins. The only write a member makes is marking their own read
-- (read_at; the column grant below keeps them from editing the rest). Sudo is an app-layer
-- cookie invisible to Postgres, so the app hides the bell and banner in sudo.

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind <> ''),
  ref TEXT,
  text TEXT NOT NULL CHECK (text <> ''),
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  banner_from TIMESTAMPTZ,
  banner_until TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  CONSTRAINT in_app_notifications_banner_window CHECK (
    banner_from IS NULL OR (banner_until IS NOT NULL AND banner_from < banner_until)
  )
);

-- The bell and banner read a member's recent ones, newest first.
CREATE INDEX IF NOT EXISTS in_app_notifications_member_created_idx
  ON public.in_app_notifications (member_id, created_at DESC);

COMMENT ON TABLE public.in_app_notifications IS
  'Local layer: what the in-app notification channel sent a member (bell list; banner while time-sensitive). Server-written; readable by the member and admins; the member can only mark their own read (read_at).';

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members and admins read in-app notifications" ON public.in_app_notifications;
CREATE POLICY "Members and admins read in-app notifications" ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members mark own in-app notifications read" ON public.in_app_notifications;
CREATE POLICY "Members mark own in-app notifications read" ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.in_app_notifications FROM anon, authenticated;
GRANT SELECT ON public.in_app_notifications TO authenticated;
GRANT UPDATE (read_at) ON public.in_app_notifications TO authenticated;
GRANT ALL ON public.in_app_notifications TO service_role;
