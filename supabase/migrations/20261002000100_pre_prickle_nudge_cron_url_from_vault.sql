-- The pre-prickle nudge job (20260831170001) called a hardcoded https://hub.quillandcup.com.
-- Read the base URL from Vault instead, like the job's auth secret: `app_url` is synced from
-- NEXT_PUBLIC_APP_URL in .env.prod by `npm run env:sync:vault` (see env-vars.config.ts).
--
-- Run that sync BEFORE this migration reaches production. Without `app_url` the URL is NULL,
-- so every run fails (visible in cron.job_run_details, and the job's Checkly heartbeat goes
-- red) rather than falling back to a built-in host.
--
-- cron.schedule with an existing job name replaces that job's schedule and command.
select cron.schedule(
  'send-pre-prickle-nudges',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := rtrim((select decrypted_secret from vault.decrypted_secrets where name = 'app_url'), '/')
      || '/api/internal/nudges/pre-prickle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'writing_nudge_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
