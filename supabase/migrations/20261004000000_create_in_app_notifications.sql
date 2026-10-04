-- In-app notifications (Local layer): what the "In the Hub" channel (lib/channels/in-app.ts) has
-- sent a member, shown as a banner at the top of the member pages until they dismiss it, it
-- expires, or the feature clears it once it's dealt with (e.g. a check-in banner once the member
-- has checked in). Server-written only, through createNotifier (lib/notifications/notify.ts).
--
-- kind is the notification kind (lib/notifications/registry.ts) and ref what it's about (e.g. a
-- prickle id), so a feature can clear its own banners; both free text, like
-- notification_preferences, since the registry is the source of truth. url is a Hub path.
--
-- Visibility: the member and admins. The only write a member makes is dismissing their own
-- (dismissed_at; the column grant below keeps them from editing the rest). Sudo is an app-layer
-- cookie invisible to Postgres, so the app hides the banner in sudo.

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind <> ''),
  ref TEXT,
  text TEXT NOT NULL CHECK (text <> ''),
  url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  dismissed_at TIMESTAMPTZ
);

-- The banner reads a member's undismissed ones, newest first.
CREATE INDEX IF NOT EXISTS in_app_notifications_member_active_idx
  ON public.in_app_notifications (member_id, created_at DESC) WHERE dismissed_at IS NULL;

COMMENT ON TABLE public.in_app_notifications IS
  'Local layer: banners the in-app notification channel sent a member. Server-written; readable by the member and admins; the member can only dismiss their own (dismissed_at).';

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members and admins read in-app notifications" ON public.in_app_notifications;
CREATE POLICY "Members and admins read in-app notifications" ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members dismiss own in-app notifications" ON public.in_app_notifications;
CREATE POLICY "Members dismiss own in-app notifications" ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (member_id = (SELECT public.current_member_id()))
  WITH CHECK (member_id = (SELECT public.current_member_id()));

REVOKE ALL ON public.in_app_notifications FROM anon, authenticated;
GRANT SELECT ON public.in_app_notifications TO authenticated;
GRANT UPDATE (dismissed_at) ON public.in_app_notifications TO authenticated;
GRANT ALL ON public.in_app_notifications TO service_role;
