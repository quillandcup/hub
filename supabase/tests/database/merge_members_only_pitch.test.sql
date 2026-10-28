-- pgTAP test for 20270223000300_merge_members_only_pitch_into_pitch.sql: prickles of the members-only
-- type move to Pitch Prickle, the alias is added and the old type is gone. Rolled back at the end.
-- The migration body is repeated below (the runner copies this file alone, so it can't \i the migration).
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SET LOCAL search_path = extensions, public;

SELECT plan(4);

DELETE FROM prickle_types WHERE normalized_name IN ('pitch', 'members-only-pitch');
INSERT INTO prickle_types (id, name, normalized_name) VALUES
  ('prty_AAAAAAAAAAA1', 'Pitch Prickle', 'pitch'),
  ('prty_AAAAAAAAAAA2', 'Members Only Pitch Prickle', 'members-only-pitch');
INSERT INTO prickles (id, start_time, end_time, source, type_id) VALUES
  ('prkl_AAAAAAAAAAA1', now(), now() + interval '1 hour', 'calendar', 'prty_AAAAAAAAAAA2');

DO $$
DECLARE
  keep_id  prickle_types.id%TYPE;
  drop_id  prickle_types.id%TYPE;
  fk       RECORD;
  moved    RECORD;
BEGIN
  SELECT id INTO keep_id FROM prickle_types WHERE normalized_name = 'pitch';
  SELECT id INTO drop_id FROM prickle_types WHERE normalized_name = 'members-only-pitch';
  IF keep_id IS NULL OR drop_id IS NULL THEN
    RETURN;
  END IF;

  -- Every column that references prickle_types(id), found from the catalog so none is missed.
  FOR fk IN
    SELECT cl.oid::regclass AS tbl, att.attname AS col
      FROM pg_constraint con
      JOIN pg_class cl ON cl.oid = con.conrelid
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = con.conkey[1]
     WHERE con.contype = 'f'
       AND con.confrelid = 'public.prickle_types'::regclass
       AND array_length(con.conkey, 1) = 1
  LOOP
    BEGIN
      EXECUTE format('UPDATE %s SET %I = $1 WHERE %I = $2', fk.tbl, fk.col, fk.col) USING keep_id, drop_id;
    EXCEPTION WHEN unique_violation THEN
      -- Some rows already exist for Pitch Prickle (same host, same slot): move the ones that fit and let
      -- the cascade or SET NULL at the delete below drop the duplicates.
      FOR moved IN EXECUTE format('SELECT ctid AS row_id FROM %s WHERE %I = $1', fk.tbl, fk.col) USING drop_id LOOP
        BEGIN
          EXECUTE format('UPDATE %s SET %I = $1 WHERE ctid = $2', fk.tbl, fk.col) USING keep_id, moved.row_id;
        EXCEPTION WHEN unique_violation THEN
          NULL;
        END;
      END LOOP;
    END;
  END LOOP;

  UPDATE prickle_types
     SET summary_aliases = (
           SELECT array_agg(DISTINCT a ORDER BY a)
             FROM unnest(summary_aliases || ARRAY['members-only-pitch']) AS a
         )
   WHERE id = keep_id;

  DELETE FROM prickle_types WHERE id = drop_id;
END $$;

SELECT is((SELECT type_id FROM prickles WHERE id = 'prkl_AAAAAAAAAAA1'), 'prty_AAAAAAAAAAA1', 'prickle moved to Pitch Prickle');
SELECT is((SELECT count(*)::int FROM prickle_types WHERE normalized_name = 'members-only-pitch'), 0, 'members-only type deleted');
SELECT ok((SELECT 'members-only-pitch' = ANY(summary_aliases) FROM prickle_types WHERE normalized_name = 'pitch'), 'alias added');
SELECT is((SELECT count(*)::int FROM prickle_types WHERE normalized_name = 'pitch'), 1, 'Pitch Prickle kept');

SELECT * FROM finish(true);
ROLLBACK;
