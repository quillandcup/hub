-- pgTAP test for 20270224300000_prickles_realtime.sql: prickles are published to Supabase Realtime
-- (the admin calendar subscribes to them). Rolled back; run with `pnpm test:pgtap`.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(1);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'prickles'
  ),
  'prickles are published to Realtime');

SELECT * FROM finish(true);
ROLLBACK;
