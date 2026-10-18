-- Preserve device consent across sign-out without allowing explicit opt-outs to be revived.
ALTER TABLE public.push_subscriptions
  ADD COLUMN paused_at timestamptz,
  ADD COLUMN disabled_at timestamptz;

-- Historical soft deletes have no reason recorded. Treat them as explicit opt-outs.
UPDATE public.push_subscriptions SET disabled_at = deleted_at WHERE deleted_at IS NOT NULL;

COMMENT ON COLUMN public.push_subscriptions.paused_at IS
  'Temporarily paused at sign-out; consent remains and the same account can resume on this browser.';
COMMENT ON COLUMN public.push_subscriptions.disabled_at IS
  'Explicitly turned off or removed by the member. Automatic resume cannot clear this; requires a new opt-in.';
