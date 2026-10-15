-- Web Push subscriptions (Local layer): one row per browser/device a member turned notifications on
-- for. The "Browser" channel (lib/channels/web-push.ts) sends to every live one. The endpoint is the
-- push service's URL for that browser; p256dh and auth are its encryption keys, so anyone holding the
-- row can push to the device: server-written and server-read only (service role), never exposed to
-- members or admins. The settings page learns this device's state from the browser itself.
--
-- deleted_at is when the subscription stopped being usable: the member turned it off, or the push
-- service said it's gone (404/410). Subscribing again on the same browser reuses the row (endpoint is
-- unique) and clears it.

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES public.members(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE CHECK (endpoint <> ''),
  p256dh TEXT NOT NULL CHECK (p256dh <> ''),
  auth TEXT NOT NULL CHECK (auth <> ''),
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_sent_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

-- Looking up a member's live subscriptions when sending.
CREATE INDEX IF NOT EXISTS push_subscriptions_member_live_idx
  ON public.push_subscriptions (member_id) WHERE deleted_at IS NULL;

COMMENT ON TABLE public.push_subscriptions IS
  'Local layer: browsers/devices a member enabled Web Push on (the Browser notification channel). Holds push credentials, so service role only. deleted_at = turned off or rejected by the push service.';

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subscriptions FROM anon, authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
