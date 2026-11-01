-- The windowed projection/reprocess functions timed out in prod ("canceling statement due to
-- statement timeout") on windows holding only ~100 messages, and only after a few calls: a
-- 90-day import passed its first five weekly windows and died on the sixth.
--
-- They are plpgsql, so each statement's plan is cached per connection, and after five executions
-- Postgres may switch to a generic plan that treats from_date/to_date as unknown. For these
-- queries that plan ignores how narrow the window is and is far slower. PostgREST goes through a
-- pooler that reuses connections, so the cached plans survive from one call to the next.
-- Forcing a custom plan plans every execution with the real dates. Bodies and grants are unchanged.
ALTER FUNCTION public.project_slack_chat_messages(TIMESTAMPTZ, TIMESTAMPTZ, JSONB)
  SET plan_cache_mode = force_custom_plan;
ALTER FUNCTION public.project_slack_chat_channels(JSONB)
  SET plan_cache_mode = force_custom_plan;
ALTER FUNCTION public.reprocess_slack_activities_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, BOOLEAN)
  SET plan_cache_mode = force_custom_plan;
ALTER FUNCTION public.reprocess_prickle_attendance_atomic(TIMESTAMPTZ, TIMESTAMPTZ, JSONB, JSONB)
  SET plan_cache_mode = force_custom_plan;
