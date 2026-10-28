-- "Members Only Pitch Prickle" and "Pitch Prickle" are one session: Pitch Prickle is already listed in Events,
-- announced publicly and members only (guests_allowed = false), so a separate members-only type says nothing
-- more. Everything that pointed at the members-only type moves to Pitch Prickle, calendar titles that
-- normalize to the old name keep matching through a summary alias, and the old type is deleted.
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

NOTIFY pgrst, 'reload schema';
