-- A program's change history also finds its enrollments. member_program_enrollments rows name a
-- cohort (cohort_id), not the program, so the generic parent-column match from 20261102000000 missed
-- them; for p_parent_column = 'program_id' a program_enrollment now matches through its cohort.
-- Otherwise identical to 20261102000000. Same signature, so CREATE OR REPLACE keeps the grants.

CREATE OR REPLACE FUNCTION get_record_history(
    p_entity_types text[],
    p_entity_id    text DEFAULT NULL,
    p_limit       integer DEFAULT 200,
    p_parent_column text DEFAULT NULL,
    p_member_rows  boolean DEFAULT false
) RETURNS TABLE (
    event_id       text,
    kind           text,
    occurred_at    timestamptz,
    is_audit       boolean,
    actor_user_id  uuid,
    actor_kind     text,
    actor_label    text,
    member_id      uuid,
    member_name    text,
    acting_as_member_id   uuid,
    acting_as_member_name text,
    event_type     text,
    entity_type    text,
    entity_id      text,
    title          text,
    description    text,
    source         text,
    data           jsonb
) AS $$
    SELECT
        'audit:' || a.id,
        'audit'::text,
        a.occurred_at,
        (a.actor_kind <> 'member' OR a.acting_as_member_id IS NOT NULL),
        a.changed_by,
        a.actor_kind,
        COALESCE(am.name, up.email, CASE WHEN a.actor_kind = 'member' THEN mem.name END),
        a.member_id,
        mem.name,
        a.acting_as_member_id,
        aam.name,
        a.action,
        a.entity_type,
        a.entity_id,
        a.comment,
        a.entity_label,
        'audit_log'::text,
        a.changes
    FROM audit_log a
    LEFT JOIN user_profiles up ON up.id = a.changed_by
    LEFT JOIN members am ON am.user_id = a.changed_by
    LEFT JOIN members mem ON mem.id = a.member_id
    LEFT JOIN members aam ON aam.id = a.acting_as_member_id
    WHERE (a.entity_type = ANY (p_entity_types) OR (p_member_rows AND p_entity_id IS NOT NULL))
      AND (
          p_entity_id IS NULL
          OR (a.entity_type = ANY (p_entity_types) AND a.entity_id = p_entity_id)
          -- a child record (an event's attendee, a badge's level) names its parent in a column of its delta
          OR (p_parent_column IS NOT NULL AND a.entity_type = ANY (p_entity_types)
              AND (a.changes -> p_parent_column ->> 'new' = p_entity_id OR a.changes -> p_parent_column ->> 'old' = p_entity_id))
          -- an enrollment names its cohort, not the program: reach the program through the cohort
          OR (p_parent_column = 'program_id' AND a.entity_type = 'program_enrollment' AND a.entity_type = ANY (p_entity_types)
              AND (a.changes -> 'cohort_id' ->> 'new' IN (SELECT c.id::text FROM program_cohorts c WHERE c.program_id::text = p_entity_id)
                   OR a.changes -> 'cohort_id' ->> 'old' IN (SELECT c.id::text FROM program_cohorts c WHERE c.program_id::text = p_entity_id)))
          -- everything about a member: rows whose subject is them (their record, aliases, hiatus, overrides...)
          OR (p_member_rows AND a.member_id::text = p_entity_id)
      )
      AND is_admin()
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

