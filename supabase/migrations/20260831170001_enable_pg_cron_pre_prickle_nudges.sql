-- Writing Projects Tracking, Phase 1, item 9: pre-prickle nudge scheduling.
--
-- Vercel Hobby-tier cron only fires once/day (see every existing job in vercel.json), but the
-- nudge needs ~15-30 min lead time per prickle occurrence. Supabase pg_cron + pg_net polls
-- app/api/internal/nudges/pre-prickle every 5 minutes instead -- keeps the actual eligibility +
-- send logic in TypeScript (reusable, testable) rather than duplicating it in PL/pgSQL.
--
-- No secret literal is committed here. Before this job can succeed, a one-time manual step is
-- required (documented in the Phase 1 plan, not run automatically by this migration):
--   1. Generate a random secret (e.g. `openssl rand -hex 32`).
--   2. Set it as the Vercel env var CRON_INTERNAL_SECRET (the endpoint checks
--      `Authorization: Bearer <that value>`).
--   3. Run, once, directly against this database (SQL editor or execute_sql -- never in a
--      migration file):
--        select vault.create_secret('<same value as step 2>', 'writing_nudge_cron_secret',
--          'pg_cron -> /api/internal/nudges/pre-prickle auth');
-- Until step 3 runs, `net.http_post` below will send an Authorization header of
-- "Bearer " (empty), and the endpoint will correctly 401 every request rather than skip auth.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'send-pre-prickle-nudges',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://hub.quillandcup.com/api/internal/nudges/pre-prickle',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'writing_nudge_cron_secret'), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
