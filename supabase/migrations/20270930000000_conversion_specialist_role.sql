set lock_timeout = '5s';

-- Conversion specialist: a marketing role (docs/architecture/PERMISSIONS.md; src/lib/permissions.ts holds what the app
-- lets it do). It edits and publishes landing pages and runs outreach, and reads nothing of the members area.
-- Expand only: one new role value and the policies that role needs. Nothing widens is_admin(), nothing is
-- removed or tightened for an existing role, and every policy here is a new permissive policy beside the admin one.
--
--   * user_profiles.role accepts 'conversion_specialist' (the check is replaced by one with the extra value).
--   * is_conversion_specialist(): the helper the policies below use, like is_community_manager().
--   * Landing pages and their versions (templates are pages too), the site header and footer, outreach leads, touches and prospects:
--     read and write, for exactly the operations the admin pages perform (no delete where the admin has none either).
--   * members: SELECT only the rows of people who are not (or no longer) members, status lead or cancelled. Outreach
--     reads them (the "Ideal Hedgie" leads); a current member's row, and every other members table, stays closed.
--   * audit_row_change() counts a conversion specialist as staff, so her page edits are logged as staff actions
--     (the latest definition, 20270624000000, with the role added).
--   * staff_member_ids() counts the member behind her account as staff, like the other staff roles.

-- Approved ban-drop-constraint ignore: the replacement check only adds a value (same as 20270430000500), so no live code depends on the old one.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist', 'member'));

CREATE OR REPLACE FUNCTION public.is_conversion_specialist()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'conversion_specialist'
  );
$$;

REVOKE ALL ON FUNCTION public.is_conversion_specialist() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_conversion_specialist() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_conversion_specialist() IS
  'True for a signed-in conversion specialist (marketing staff: landing pages and outreach). Use in policies beside is_admin(), only on the tables their pages need.';

------------------------------------------------------------------------------------------------
-- Landing pages (templates are pages of kind 'template'), their versions, and the site header and footer
------------------------------------------------------------------------------------------------

CREATE POLICY "Conversion specialists read landing pages" ON public.landing_pages
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists create landing pages" ON public.landing_pages
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists change landing pages" ON public.landing_pages
  FOR UPDATE TO authenticated USING ((SELECT public.is_conversion_specialist())) WITH CHECK ((SELECT public.is_conversion_specialist()));

CREATE POLICY "Conversion specialists read landing page versions" ON public.landing_page_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists add landing page versions" ON public.landing_page_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));

CREATE POLICY "Conversion specialists read the site template" ON public.landing_site_template
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists create the site template" ON public.landing_site_template
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists change the site template" ON public.landing_site_template
  FOR UPDATE TO authenticated USING ((SELECT public.is_conversion_specialist())) WITH CHECK ((SELECT public.is_conversion_specialist()));

CREATE POLICY "Conversion specialists read site template versions" ON public.landing_site_template_versions
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists add site template versions" ON public.landing_site_template_versions
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));

------------------------------------------------------------------------------------------------
-- Outreach: leads, touches, prospects, and the lead rows they point at
------------------------------------------------------------------------------------------------

CREATE POLICY "Conversion specialists read outreach_leads" ON public.outreach_leads
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists insert outreach_leads" ON public.outreach_leads
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists update outreach_leads" ON public.outreach_leads
  FOR UPDATE TO authenticated USING ((SELECT public.is_conversion_specialist())) WITH CHECK ((SELECT public.is_conversion_specialist()));

CREATE POLICY "Conversion specialists read outreach_touches" ON public.outreach_touches
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists insert outreach_touches" ON public.outreach_touches
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));

CREATE POLICY "Conversion specialists read outreach_prospects" ON public.outreach_prospects
  FOR SELECT TO authenticated USING ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists insert outreach_prospects" ON public.outreach_prospects
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_conversion_specialist()));
CREATE POLICY "Conversion specialists update outreach_prospects" ON public.outreach_prospects
  FOR UPDATE TO authenticated USING ((SELECT public.is_conversion_specialist())) WITH CHECK ((SELECT public.is_conversion_specialist()));

-- Outreach lists the people who never joined (lead) or left (cancelled). Only those rows: a current member's row stays closed.
CREATE POLICY "Conversion specialists read leads and former members" ON public.members
  FOR SELECT TO authenticated
  USING ((SELECT public.is_conversion_specialist()) AND status IN ('lead', 'cancelled'));

------------------------------------------------------------------------------------------------
-- Staff classification
------------------------------------------------------------------------------------------------

-- audit_row_change(): the latest definition (20270624000000) with conversion_specialist counted as staff.
CREATE OR REPLACE FUNCTION public.audit_row_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    mid       text;
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
        mid := (subject ->> 'id');
    ELSIF subject ? 'member_id' THEN
        mid := (subject ->> 'member_id');
    ELSIF subject ? 'spinner_member_id' THEN
        mid := (subject ->> 'spinner_member_id');
    END IF;

    -- A community manager is staff: her writes are staff actions, not a member's own.
    kind := CASE
        WHEN uid IS NULL THEN 'system'
        WHEN EXISTS (
            SELECT 1 FROM user_profiles WHERE id = uid AND role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist')
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
$function$;

-- staff_member_ids(): the latest definition (20270819000000) with conversion_specialist added.
CREATE OR REPLACE FUNCTION public.staff_member_ids()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.member_id FROM staff s WHERE s.member_id IS NOT NULL
  UNION
  SELECT m.id
  FROM members m
  JOIN user_profiles p ON p.id = m.user_id
  WHERE p.role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist');
$function$;

REVOKE ALL ON FUNCTION public.staff_member_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_member_ids() TO service_role;
COMMENT ON FUNCTION public.staff_member_ids() IS
  'The one definition of a staff member: members linked in the staff roster, and the members behind admin, assistant, community manager and conversion specialist accounts. Service role only.';

NOTIFY pgrst, 'reload schema';
