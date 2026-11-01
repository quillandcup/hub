-- Lesson viewing is logged to member_activities (source 'courses', lib/courses/activity.ts) by a
-- best-effort insert next to the primary write. This index is what keeps it to one row per member
-- and lesson per day for 'lesson_watched' (related_id = '<lesson id>:<local date>') and one per
-- member and lesson for 'lesson_completed' (related_id = '<lesson id>'): a repeat insert fails with
-- 23505 and the writer ignores it. Partial, so it never constrains other sources' rows. A plain
-- insert rather than an upsert on purpose: PostgREST can't name a partial index in on_conflict.
CREATE UNIQUE INDEX idx_member_activities_courses_dedup
  ON public.member_activities (member_id, activity_type, related_id) WHERE source = 'courses';
