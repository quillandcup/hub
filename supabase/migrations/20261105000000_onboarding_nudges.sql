-- Reminders: newcomers (first 90 days) introduce themselves in #start-here, and any active member
-- without a prickle coming up and no recent attendance gets asked to schedule one, with backoff
-- (lib/onboarding-nudges.ts). One row per reminder sent, so
-- the job can back off between them and send at most one per member, kind and day even
-- if two runs overlap.

CREATE TABLE onboarding_nudge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('intro_nudge', 'prickle_nudge')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  sent_on date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date,
  UNIQUE (member_id, kind, sent_on)
);

ALTER TABLE onboarding_nudge_log ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE onboarding_nudge_log IS
  'LOCAL: log of reminders sent (intro_nudge, prickle_nudge), for backoff and dedup. Service-role only.';

-- Hourly (each member's reminders go out in their own hour), same shape as send-prickle-checkins (the Vault secret keeps its old name).
SELECT cron.schedule(
  'send-onboarding-nudges',
  '0 * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), '/')
      || '/api/internal/onboarding-nudges',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'writing_nudge_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
