-- Fold the audit rows written before audit_row_change kept a transaction's net effect.
--
-- Until 20261013000000, a pipeline that wrote a record twice in one transaction logged both writes:
-- reprocess_members_atomic set the Kajabi-derived status and then re-applied lifetime/gift/cohort/
-- hiatus overrides, so an overridden member logged `active -> cancelled` and `cancelled -> active` on
-- every run. This applies the trigger's rule to those rows: UPDATE rows for the same record, actor
-- and sudo context that share an occurred_at (now() is the transaction start, so it is the same for
-- every write in one transaction) become one row with the first old value and the last new value per
-- column; columns that net out to no change drop, and a row left with nothing is deleted.
--
-- Conservative on purpose: only UPDATE rows, only groups with no comment, and a redacted column is
-- never dropped (its old and new both read "[redacted]", so a revert can't be told from a change).
-- Nothing is lost that a reader could have used: what remains is the same net change.

CREATE TEMP TABLE audit_fold AS
WITH grp AS (
    SELECT entity_type, entity_id, occurred_at, changed_by, acting_as_member_id
      FROM audit_log
     WHERE action = 'update'
     GROUP BY entity_type, entity_id, occurred_at, changed_by, acting_as_member_id
    HAVING count(*) > 1 AND bool_and(comment IS NULL)
), rows_in AS (
    SELECT a.id, g.entity_type, g.entity_id, g.occurred_at, g.changed_by, g.acting_as_member_id,
           a.changes, a.entity_label
      FROM audit_log a
      JOIN grp g
        ON g.entity_type = a.entity_type AND g.entity_id = a.entity_id AND g.occurred_at = a.occurred_at
       AND g.changed_by IS NOT DISTINCT FROM a.changed_by
       AND g.acting_as_member_id IS NOT DISTINCT FROM a.acting_as_member_id
     WHERE a.action = 'update'
), per_col AS (
    SELECT r.entity_type, r.entity_id, r.occurred_at, r.changed_by, r.acting_as_member_id, c.key AS col,
           (array_agg(c.value -> 'old' ORDER BY r.id))[1] AS first_old,
           (array_agg(c.value -> 'new' ORDER BY r.id DESC))[1] AS last_new
      FROM rows_in r, jsonb_each(r.changes) c
     GROUP BY 1, 2, 3, 4, 5, 6
), merged AS (
    SELECT entity_type, entity_id, occurred_at, changed_by, acting_as_member_id,
           jsonb_object_agg(col, jsonb_build_object('old', first_old, 'new', last_new)) AS changes
      FROM per_col
     WHERE first_old IS DISTINCT FROM last_new OR first_old = '"[redacted]"'::jsonb
     GROUP BY 1, 2, 3, 4, 5
)
SELECT g.keeper_id, g.last_label, g.entity_type, g.entity_id, g.occurred_at, g.changed_by, g.acting_as_member_id,
       m.changes AS merged_changes
  FROM (
        SELECT min(id) AS keeper_id,
               (array_agg(entity_label ORDER BY id DESC) FILTER (WHERE entity_label IS NOT NULL))[1] AS last_label,
               entity_type, entity_id, occurred_at, changed_by, acting_as_member_id
          FROM rows_in
         GROUP BY entity_type, entity_id, occurred_at, changed_by, acting_as_member_id
       ) g
  LEFT JOIN merged m
    ON m.entity_type = g.entity_type AND m.entity_id = g.entity_id AND m.occurred_at = g.occurred_at
   AND m.changed_by IS NOT DISTINCT FROM g.changed_by
   AND m.acting_as_member_id IS NOT DISTINCT FROM g.acting_as_member_id;

-- Everything in a folded group except the row that keeps the merged result.
DELETE FROM audit_log a
 USING audit_fold f
 WHERE a.action = 'update'
   AND a.entity_type = f.entity_type AND a.entity_id = f.entity_id AND a.occurred_at = f.occurred_at
   AND a.changed_by IS NOT DISTINCT FROM f.changed_by
   AND a.acting_as_member_id IS NOT DISTINCT FROM f.acting_as_member_id
   AND (a.id <> f.keeper_id OR f.merged_changes IS NULL);

UPDATE audit_log a
   SET changes = f.merged_changes,
       entity_label = COALESCE(f.last_label, a.entity_label)
  FROM audit_fold f
 WHERE a.id = f.keeper_id AND f.merged_changes IS NOT NULL;

DROP TABLE audit_fold;
