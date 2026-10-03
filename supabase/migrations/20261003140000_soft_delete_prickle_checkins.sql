-- Clearing every answer on a check-in (on the prickle page or in a check-in/check-out DM) now
-- soft-deletes it instead of deleting the row: deleted_at is set and the last answers are kept.
-- Saving again restores it (the upsert clears deleted_at). Reads filter deleted_at IS NULL.
--
-- Members lose DELETE so clearing can only soft-delete. The ON DELETE CASCADEs from members and
-- prickles still remove rows when either is really deleted.

ALTER TABLE public.prickle_checkins ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

DROP POLICY IF EXISTS "Members delete own check-ins" ON public.prickle_checkins;
REVOKE DELETE ON public.prickle_checkins FROM authenticated;

COMMENT ON COLUMN public.prickle_checkins.deleted_at IS
  'Set when the member cleared every answer; the row keeps its last answers. NULL = live.';
