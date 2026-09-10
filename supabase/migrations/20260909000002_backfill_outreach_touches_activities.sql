-- One-time backfill: mirror every existing outreach_touches row into
-- member_activities. Idempotent via NOT EXISTS, safe to re-run.
INSERT INTO member_activities (member_id, activity_type, activity_category, title, actor_kind, actor_user_id, engagement_value, occurred_at, source, related_id)
SELECT
  ot.member_id, 'outreach_touch_logged', 'communication', 'Outreach touch logged', 'staff', ot.touched_by, 0, ot.touched_at, 'outreach_touches', ot.id::text
FROM outreach_touches ot
WHERE NOT EXISTS (
  SELECT 1 FROM member_activities ma WHERE ma.source = 'outreach_touches' AND ma.related_id = ot.id::text
);
