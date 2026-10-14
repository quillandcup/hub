-- Names on audit rows for records that have no title of their own. entity_label used to be the row's
-- title/name/alias/award_name, so a badge award, a segment membership, an event attendee or a feature
-- flag showed as just its type. audit_entity_label(entity, row) resolves a readable name per entity
-- (the badge's name for a member_badge, the segment's for a segment_member, the flag key...) and
-- falls back to the old rule. audit_row_change calls it; it is otherwise identical to
-- 20261013000000. Existing insert/delete rows with no label are filled in from their delta.

CREATE OR REPLACE FUNCTION audit_entity_label(entity text, subject jsonb) RETURNS text AS $$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id')::uuid)
            WHEN 'event_attendee' THEN (SELECT e.title FROM events e WHERE e.id = (subject ->> 'event_id')::uuid)
            WHEN 'event_photo' THEN (SELECT e.title FROM events e WHERE e.id = (subject ->> 'event_id')::uuid)
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')::uuid)
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')::uuid))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')::uuid), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')::uuid), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')::uuid)
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$$ LANGUAGE sql STABLE SET search_path = public;

REVOKE EXECUTE ON FUNCTION audit_entity_label(text, jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION audit_row_change() RETURNS trigger AS $$
DECLARE
    new_row   jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
    old_row   jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
    subject   jsonb := COALESCE(new_row, old_row);
    delta     jsonb := '{}'::jsonb;
    col       text;
    pk_col    text;
    pk_parts  text[] := '{}';
    uid       uuid := auth.uid();
    kind      text;
    mid       uuid;
    label     text;
    eid       text;
    prev      record;
    merged    jsonb;
    -- Columns named in the third trigger argument are logged as changed but
    -- never with their value (secrets such as a calendar feed token).
    redact    text[] := COALESCE(string_to_array(TG_ARGV[2], ','), '{}');
BEGIN
    FOR col IN SELECT jsonb_object_keys(subject) LOOP
        -- Bookkeeping timestamps change on every write and say nothing.
        CONTINUE WHEN col IN ('updated_at', 'created_at');
        IF TG_OP = 'UPDATE' AND (old_row -> col) IS NOT DISTINCT FROM (new_row -> col) THEN
            CONTINUE;
        END IF;
        IF col = ANY (redact) THEN
            delta := delta || jsonb_build_object(
                col, jsonb_build_object(
                    'old', CASE WHEN old_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END,
                    'new', CASE WHEN new_row IS NULL THEN NULL ELSE '"[redacted]"'::jsonb END)
            );
        ELSE
            delta := delta || jsonb_build_object(
                col, jsonb_build_object('old', old_row -> col, 'new', new_row -> col)
            );
        END IF;
    END LOOP;

    -- An UPDATE that only touched bookkeeping columns is not worth a row.
    IF TG_OP = 'UPDATE' AND delta = '{}'::jsonb THEN
        RETURN NEW;
    END IF;

    FOREACH pk_col IN ARRAY string_to_array(TG_ARGV[1], ',') LOOP
        pk_parts := pk_parts || COALESCE(subject ->> trim(pk_col), '');
    END LOOP;

    -- What the record is called, so a row can say which project/book/award it was about even when
    -- an UPDATE's delta carries only the changed fields.
    label := audit_entity_label(TG_ARGV[0], subject);

    IF TG_ARGV[0] = 'member' THEN
        mid := (subject ->> 'id')::uuid;
    ELSIF subject ? 'member_id' THEN
        mid := (subject ->> 'member_id')::uuid;
    ELSIF subject ? 'spinner_member_id' THEN
        mid := (subject ->> 'spinner_member_id')::uuid;
    END IF;

    kind := CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (
            SELECT 1 FROM user_profiles WHERE id = uid AND role IN ('admin', 'assistant')
        ) THEN 'staff'
        ELSE 'member'
    END;

    eid := array_to_string(pk_parts, ':');

    -- Record a transaction's net effect on a row, not every step. A pipeline that writes a row
    -- more than once in one transaction (reprocess_members_atomic sets the Kajabi-derived status,
    -- then re-applies lifetime/hiatus/cohort overrides) would otherwise log a flip and its
    -- restore, which is churn: fold this change into that transaction's earlier row for the
    -- record, and drop the row entirely if it all nets out to nothing.
    IF TG_OP = 'UPDATE' THEN
        SELECT id, action, changes INTO prev FROM audit_log
         WHERE txid = txid_current() AND entity_type = TG_ARGV[0] AND entity_id = eid
           AND action IN ('insert', 'update') AND changed_by IS NOT DISTINCT FROM uid
           AND acting_as_member_id IS NOT DISTINCT FROM current_acting_as_member_id()
         ORDER BY id DESC LIMIT 1;
        IF FOUND THEN
            merged := prev.changes;
            FOR col IN SELECT jsonb_object_keys(delta) LOOP
                IF merged ? col THEN
                    merged := jsonb_set(merged, ARRAY[col, 'new'], delta -> col -> 'new');
                    -- A redacted column reads "[redacted]" on both sides whatever happened to it, so
                    -- it can't be shown to have reverted; keep it rather than hide a real change.
                    IF prev.action = 'update' AND (merged -> col -> 'old') = (merged -> col -> 'new')
                       AND (merged -> col -> 'old') <> '"[redacted]"'::jsonb THEN
                        merged := merged - col;
                    END IF;
                ELSIF prev.action = 'insert' THEN
                    merged := merged || jsonb_build_object(col, jsonb_build_object('old', NULL, 'new', delta -> col -> 'new'));
                ELSE
                    merged := merged || jsonb_build_object(col, delta -> col);
                END IF;
            END LOOP;
            IF prev.action = 'update' AND merged = '{}'::jsonb THEN
                DELETE FROM audit_log WHERE id = prev.id;
            ELSE
                UPDATE audit_log SET changes = merged, entity_label = COALESCE(label, entity_label) WHERE id = prev.id;
            END IF;
            RETURN NEW;
        END IF;
    END IF;

    INSERT INTO audit_log (changed_by, actor_kind, acting_as_member_id, entity_type, entity_id, action, changes, member_id, entity_label)
    VALUES (uid, kind, current_acting_as_member_id(), TG_ARGV[0], eid, lower(TG_OP), delta, mid, label);

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;


-- Fill labels in for rows written before this: inserts and deletes carry the whole record in their delta.
UPDATE audit_log a
   SET entity_label = audit_entity_label(
       a.entity_type,
       (SELECT jsonb_object_agg(k, CASE WHEN a.action = 'delete' THEN v -> 'old' ELSE v -> 'new' END)
          FROM jsonb_each(a.changes) AS d(k, v)))
 WHERE a.entity_label IS NULL AND a.action IN ('insert', 'delete');
