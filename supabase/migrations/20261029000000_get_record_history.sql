-- Change history of one record, for the "history" clock icon next to a record in the admin UI:
-- every audit_log row for (entity_type, entity_id), newest first, in the same shape as
-- get_activity_feed() so the activity table renders it unchanged. Admin-only (is_admin()), like
-- the feed. Histories are short (one record), so there is no paging: p_limit caps it.

CREATE OR REPLACE FUNCTION get_record_history(
    p_entity_type text,
    p_entity_id   text,
    p_limit       integer DEFAULT 200
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
    WHERE a.entity_type = p_entity_type
      AND a.entity_id = p_entity_id
      AND is_admin()
    ORDER BY a.occurred_at DESC, a.id DESC
    LIMIT LEAST(GREATEST(p_limit, 1), 500);
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION get_record_history(text, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_record_history(text, text, integer) TO authenticated;
