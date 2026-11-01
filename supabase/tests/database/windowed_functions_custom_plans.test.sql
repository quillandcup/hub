BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- Windowed functions must not fall back to a cached generic plan (see the migration).
SELECT ok(
  (SELECT 'plan_cache_mode=force_custom_plan' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.project_slack_chat_messages(timestamptz, timestamptz, jsonb)'::regprocedure),
  'project_slack_chat_messages plans each call with its own dates');
SELECT ok(
  (SELECT 'plan_cache_mode=force_custom_plan' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.project_slack_chat_channels(jsonb)'::regprocedure),
  'project_slack_chat_channels plans each call');
SELECT ok(
  (SELECT 'plan_cache_mode=force_custom_plan' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.reprocess_slack_activities_atomic(timestamptz, timestamptz, jsonb, boolean)'::regprocedure),
  'reprocess_slack_activities_atomic plans each call with its own dates');
SELECT ok(
  (SELECT 'plan_cache_mode=force_custom_plan' = ANY (proconfig) FROM pg_proc WHERE oid = 'public.reprocess_prickle_attendance_atomic(timestamptz, timestamptz, jsonb, jsonb)'::regprocedure),
  'reprocess_prickle_attendance_atomic plans each call with its own dates');

SELECT * FROM finish(true);
ROLLBACK;
