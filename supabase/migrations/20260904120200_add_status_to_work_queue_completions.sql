-- Extend admin_work_queue_completions to support two new per-occurrence
-- outcomes beyond "handled" (Ania's Hedgieversary-only asks):
--
--   - opted_out: the member doesn't want a celebration for this occurrence.
--     Suppresses the item permanently, same as 'completed'.
--   - postponed: staff wants to celebrate later (e.g. once someone's back
--     from travel). Suppresses the item until `postponed_until`, then it
--     naturally resurfaces in the queue — lib/admin-work-queue.ts checks
--     `now < postponed_until` rather than treating any row as a permanent
--     suppression.
--
-- 'welcome_back' and 'hiatus_nudge' rows only ever use 'completed' — the
-- POST route (app/api/admin/work-queue/complete/route.ts) rejects
-- 'opted_out'/'postponed' for those queue types.
--
-- Existing rows default to 'completed', which is correct: everything
-- recorded before this migration was a "Mark Done" click.
ALTER TABLE admin_work_queue_completions
  ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
    CHECK (status IN ('completed', 'opted_out', 'postponed')),
  ADD COLUMN postponed_until DATE,
  ADD CONSTRAINT admin_work_queue_completions_postponed_until_required
    CHECK (status != 'postponed' OR postponed_until IS NOT NULL);

COMMENT ON COLUMN admin_work_queue_completions.status IS
  'completed = handled; opted_out = member permanently declines (Hedgieversary only); postponed = suppressed until postponed_until, then resurfaces (Hedgieversary only).';
COMMENT ON COLUMN admin_work_queue_completions.postponed_until IS
  'Date the item resurfaces in the queue. Required when status = postponed, null otherwise.';
