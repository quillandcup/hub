-- The Tier 1 short id migration (20261215000000) queued each Storage rename in
-- storage_path_moves; scripts/move-storage-objects.ts moved all 109 objects on 2026-10-23
-- (109 moved, 0 failed) and deleted each row. The queue is empty and nothing reads it now.
DROP TABLE public.storage_path_moves;

-- Make PostgREST re-read the schema so it stops listing the table.
NOTIFY pgrst, 'reload schema';
