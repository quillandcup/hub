-- The pre-prickle nudge and post-prickle prompt DMs are now the prickle check-in and check-out:
-- they ask the member's check-in questions (prickle_checkins) in Slack. Rename their dedup log,
-- its kinds and the cron job to match.
--
-- Deploy gap: CI pushes migrations before the Vercel deploy, so for a few minutes the old code
-- runs against the new names. It fails closed: its log inserts miss the renamed table and the
-- cron hits a route that isn't live yet, so nothing is sent and no DM goes out twice (existing
-- rows keep their dedup under the new kinds).

ALTER TABLE writing_nudge_log RENAME TO prickle_checkin_dm_log;
ALTER TABLE prickle_checkin_dm_log RENAME CONSTRAINT writing_nudge_log_pkey TO prickle_checkin_dm_log_pkey;
ALTER TABLE prickle_checkin_dm_log
  RENAME CONSTRAINT writing_nudge_log_prickle_id_member_id_kind_key TO prickle_checkin_dm_log_prickle_id_member_id_kind_key;
ALTER TABLE prickle_checkin_dm_log RENAME CONSTRAINT writing_nudge_log_prickle_id_fkey TO prickle_checkin_dm_log_prickle_id_fkey;
ALTER TABLE prickle_checkin_dm_log RENAME CONSTRAINT writing_nudge_log_member_id_fkey TO prickle_checkin_dm_log_member_id_fkey;

ALTER TABLE prickle_checkin_dm_log DROP CONSTRAINT writing_nudge_log_kind_check;
UPDATE prickle_checkin_dm_log SET kind = 'prickle_checkin' WHERE kind = 'pre_prickle_nudge';
UPDATE prickle_checkin_dm_log SET kind = 'prickle_checkout' WHERE kind = 'post_prickle_prompt';
ALTER TABLE prickle_checkin_dm_log
  ADD CONSTRAINT prickle_checkin_dm_log_kind_check CHECK (kind IN ('prickle_checkin', 'prickle_checkout'));

COMMENT ON TABLE prickle_checkin_dm_log IS
  'LOCAL: dedup log for the prickle check-in and check-out Slack DMs (lib/prickle-checkin-dms.ts). Service-role only.';

-- Same schedule and command as 20261002000100, at the renamed route. The Vault secret keeps its
-- name (writing_nudge_cron_secret): renaming it means re-syncing CRON_INTERNAL_SECRET.
SELECT cron.unschedule('send-pre-prickle-nudges');

SELECT cron.schedule(
  'send-prickle-checkins',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), '/')
      || '/api/internal/prickle-checkins',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'writing_nudge_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
