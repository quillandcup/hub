set lock_timeout = '5s';

-- What a member owns, for the merge dialog (docs/MEMBER_MERGE.md): the number of rows in every public table with a
-- foreign key to members, per table and column. A merge deletes the duplicate and nearly every such table cascades,
-- so an admin sees here what would go. The tables are found in pg_constraint, so a new table is counted without a
-- change here. Only single-column foreign keys to members.id are followed; member_directory is a view (not a table
-- with a foreign key), and the derived stats are left out because a merge recomputes them. Tables with no rows for
-- the member are left out. Admin only (or the service role), since it reads across every table.
CREATE OR REPLACE FUNCTION public.member_owned_row_counts(p_member_id text)
RETURNS TABLE (table_name text, column_name text, row_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_catalog AS $$
DECLARE
  r record;
  n bigint;
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR (SELECT public.is_admin())) THEN
    RAISE EXCEPTION 'Only admins can count a member''s data' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT c.relname::text AS tbl, a.attname::text AS col
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_namespace ns ON ns.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
     WHERE k.contype = 'f'
       AND k.confrelid = 'public.members'::regclass
       AND array_length(k.conkey, 1) = 1
       AND ns.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relname NOT IN ('member_directory', 'member_metrics', 'member_engagement')
     ORDER BY c.relname, a.attname
  LOOP
    n := (xpath(
      '/row/c/text()',
      query_to_xml(format('SELECT count(*) AS c FROM public.%I WHERE %I = %L', r.tbl, r.col, p_member_id), false, true, '')
    ))[1]::text::bigint;
    IF n > 0 THEN
      table_name := r.tbl;
      column_name := r.col;
      row_count := n;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_owned_row_counts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.member_owned_row_counts(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.member_owned_row_counts(text) IS
  'Rows per public table and column that reference members.id for one member (zero counts left out; derived stats left out). Admin or service role only.';
