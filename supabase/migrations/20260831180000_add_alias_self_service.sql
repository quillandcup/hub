-- Support member self-service management of their own name/email aliases
-- (Settings page: Real Name, Pen Name(s) / Zoom aliases, email aliases).
--
-- Two changes:
-- 1. Soft-delete (`active` flag) instead of hard DELETE. There's no reliable
--    way to know whether an alias is load-bearing for *historical*
--    prickle_attendance (nothing links a specific alias to the attendance
--    rows it produced), and reprocessing replays date ranges from Bronze +
--    Local sources. Deactivating an alias stops it from matching NEW
--    attendance/imports going forward, but keeps the row so reprocessing an
--    older date range still resolves past attendance the same way it did
--    when the alias was created.
-- 2. Member-scoped RLS. Both alias tables previously allowed any
--    authenticated user to read/write every row. This feature adds the
--    first member-facing (non-admin) write path to these tables, so
--    ownership needs to be enforced at the database level, not just in the
--    app layer.

ALTER TABLE member_name_aliases ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE member_email_aliases ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_member_name_aliases_active ON member_name_aliases(active);
CREATE INDEX IF NOT EXISTS idx_member_email_aliases_active ON member_email_aliases(active);

COMMENT ON COLUMN member_name_aliases.active IS 'Soft-delete flag. Inactive aliases stop matching new Zoom/Slack attendance but are kept so reprocessing historical date ranges still resolves past attendance correctly.';
COMMENT ON COLUMN member_email_aliases.active IS 'Soft-delete flag. Inactive aliases stop matching new imports but are kept so reprocessing still resolves historical data correctly.';

-- Members can now add their own name aliases directly (pen names / Zoom
-- names), not just via admin-driven Zoom/Slack unmatched-name resolution.
ALTER TABLE member_name_aliases DROP CONSTRAINT IF EXISTS member_name_aliases_source_check;
ALTER TABLE member_name_aliases ADD CONSTRAINT member_name_aliases_source_check
  CHECK (source IN ('zoom', 'slack', 'member'));

-- Matching should only ever consider active aliases.
CREATE OR REPLACE FUNCTION match_member_by_name(
    zoom_name TEXT,
    zoom_email TEXT DEFAULT NULL
) RETURNS TABLE (
    member_id UUID,
    confidence TEXT,
    match_type TEXT
) AS $$
DECLARE
    normalized_zoom_name TEXT;
BEGIN
    -- 1. Email match (highest confidence)
    IF zoom_email IS NOT NULL THEN
        RETURN QUERY
        SELECT m.id, 'high'::TEXT, 'email'::TEXT
        FROM members m
        WHERE m.email = LOWER(zoom_email)
        LIMIT 1;

        IF FOUND THEN
            RETURN;
        END IF;
    END IF;

    -- 2. Exact alias match (active only)
    RETURN QUERY
    SELECT a.member_id, 'high'::TEXT, 'alias'::TEXT
    FROM member_name_aliases a
    WHERE a.alias = zoom_name AND a.active
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- Normalize the zoom name for remaining matches
    normalized_zoom_name := normalize_name(zoom_name);

    -- 3. Normalized name match
    RETURN QUERY
    SELECT m.id, 'high'::TEXT, 'normalized'::TEXT
    FROM members m
    WHERE normalize_name(m.name) = normalized_zoom_name
    LIMIT 1;

    IF FOUND THEN
        RETURN;
    END IF;

    -- 4. Fuzzy match using trigram similarity
    RETURN QUERY
    SELECT
        m.id,
        CASE
            WHEN similarity(normalize_name(m.name), normalized_zoom_name) >= 0.6 THEN 'medium'::TEXT
            ELSE 'low'::TEXT
        END as confidence,
        'fuzzy'::TEXT as match_type
    FROM members m
    WHERE similarity(normalize_name(m.name), normalized_zoom_name) >= 0.4
    ORDER BY similarity(normalize_name(m.name), normalized_zoom_name) DESC
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- Resolve the members.id row for the currently authenticated user, matched
-- the same way lib/sudo.ts#getEffectiveIdentity resolves identity (by
-- members.user_id when set, falling back to email) — but note this does NOT
-- account for admin sudo (that's an app-layer concept via a signed cookie,
-- invisible to Postgres); admins get full access via is_admin() instead.
CREATE OR REPLACE FUNCTION current_member_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id FROM members
  WHERE user_id = (SELECT auth.uid())
     OR email = (SELECT auth.jwt() ->> 'email')
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION current_member_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION current_member_id() TO authenticated, service_role;

COMMENT ON FUNCTION current_member_id() IS 'Resolves the members.id row owned by the currently authenticated auth user, for use in RLS policies on member-scoped tables.';

-- member_name_aliases: members manage only their own rows; admins manage
-- all. Hard DELETE stays admin-only — self-service "delete" is a soft
-- deactivate via UPDATE (active = false).
DROP POLICY IF EXISTS "Allow authenticated access to member_name_aliases" ON member_name_aliases;

CREATE POLICY "View own name aliases, admins view all"
    ON member_name_aliases FOR SELECT
    USING (member_id = (SELECT current_member_id()) OR (SELECT is_admin()));

CREATE POLICY "Insert own name aliases, admins insert any"
    ON member_name_aliases FOR INSERT
    WITH CHECK (member_id = (SELECT current_member_id()) OR (SELECT is_admin()));

CREATE POLICY "Update own name aliases, admins update any"
    ON member_name_aliases FOR UPDATE
    USING (member_id = (SELECT current_member_id()) OR (SELECT is_admin()))
    WITH CHECK (member_id = (SELECT current_member_id()) OR (SELECT is_admin()));

CREATE POLICY "Admins delete name aliases"
    ON member_name_aliases FOR DELETE
    USING ((SELECT is_admin()));

-- member_email_aliases: ownership is via canonical_email matching the
-- member's own email (mirrors how the merge/reconciliation code already
-- treats canonical_email as "this member's email").
DROP POLICY IF EXISTS "Authenticated users can view member_email_aliases" ON member_email_aliases;
DROP POLICY IF EXISTS "Authenticated users can modify member_email_aliases" ON member_email_aliases;

CREATE POLICY "View own email aliases, admins view all"
    ON member_email_aliases FOR SELECT
    USING (
        canonical_email = (SELECT email FROM members WHERE id = (SELECT current_member_id()))
        OR (SELECT is_admin())
    );

CREATE POLICY "Insert own email aliases, admins insert any"
    ON member_email_aliases FOR INSERT
    WITH CHECK (
        canonical_email = (SELECT email FROM members WHERE id = (SELECT current_member_id()))
        OR (SELECT is_admin())
    );

CREATE POLICY "Update own email aliases, admins update any"
    ON member_email_aliases FOR UPDATE
    USING (
        canonical_email = (SELECT email FROM members WHERE id = (SELECT current_member_id()))
        OR (SELECT is_admin())
    )
    WITH CHECK (
        canonical_email = (SELECT email FROM members WHERE id = (SELECT current_member_id()))
        OR (SELECT is_admin())
    );

CREATE POLICY "Admins delete email aliases"
    ON member_email_aliases FOR DELETE
    USING ((SELECT is_admin()));
