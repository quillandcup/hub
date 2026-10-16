-- The hourly reminders job covers more than onboarding: the intro reminder is for newcomers, but the
-- prickle reminder is for any active member and never stops while they're a member. Rename what
-- 20261105000000 created from "onboarding nudges" to "member reminders" (lib/member-reminders.ts,
-- /api/internal/member-reminders).
--
-- Deploy gap: CI pushes migrations before the Vercel deploy, so for a few minutes the old code runs
-- against the new names. It fails closed, and the job only logs unless a feature flag covers the
-- member: its log reads and writes miss the renamed table (nothing is sent twice, since nothing is
-- sent without a log row), and the new cron job calls a route that isn't live until the deploy lands
-- (one skipped hour at worst).

ALTER TABLE onboarding_nudge_log RENAME TO member_reminder_log;
ALTER TABLE member_reminder_log RENAME CONSTRAINT onboarding_nudge_log_pkey TO member_reminder_log_pkey;
ALTER TABLE member_reminder_log
  RENAME CONSTRAINT onboarding_nudge_log_member_id_kind_sent_on_key TO member_reminder_log_member_id_kind_sent_on_key;
ALTER TABLE member_reminder_log
  RENAME CONSTRAINT onboarding_nudge_log_member_id_fkey TO member_reminder_log_member_id_fkey;
ALTER TABLE member_reminder_log
  RENAME CONSTRAINT onboarding_nudge_log_kind_check TO member_reminder_log_kind_check;

COMMENT ON TABLE member_reminder_log IS
  'LOCAL: log of member reminders sent (intro_nudge, prickle_nudge), for backoff and dedup. Service-role only.';

-- Same schedule and command, at the renamed route (the Vault secret keeps its name).
SELECT cron.unschedule('send-onboarding-nudges');

SELECT cron.schedule(
  'send-member-reminders',
  '0 * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), '/')
      || '/api/internal/member-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'writing_nudge_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
