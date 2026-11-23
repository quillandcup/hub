set lock_timeout = '5s';

-- Several roles per user (docs/architecture/PERMISSIONS.md, "A person can hold several roles"). Until now
-- user_profiles.role was one column, so a person was exactly one of admin, assistant, community manager, conversion
-- specialist or member. A user now holds a SET of roles (user_roles) and what they may do is the union of the roles.
--
-- EXPAND only. Nothing live code reads is removed or changed in meaning:
--
--   * user_roles: one row per (user, staff role). A member is the absence of rows. Backfilled from user_profiles.role.
--   * user_profiles.role and its check constraint stay. The column holds the user's highest-priority role (admin, then
--     assistant, community manager, conversion specialist; staff_role_rank() is the one place it is written in SQL,
--     STAFF_ROLES in src/lib/permissions.ts the one in code), or 'member' with no role. A trigger keeps it in step with
--     user_roles, and a second trigger keeps user_roles in step when something still writes the column directly
--     (a direct write means "exactly this role"). Everything that still reads the column sees the primary role.
--   * is_admin(), is_community_manager(), is_conversion_specialist(), staff_member_ids(), audit_row_change() and
--     can_own_care_plans() become exists-checks over user_roles OR the old column, so a single-role user can do exactly
--     what they could and nothing widens (is_admin() is still only the admin role).
--   * The access token hook adds an app_roles array and keeps app_role (the primary role).
--   * set_user_roles(): the one call that replaces a user's set, as the person who calls it, so the Activity Log names them.
--   * Who may change roles (enforced by a trigger on user_roles, so the function, a direct write and the old column all obey it):
--     an actor may give or take away only roles strictly BELOW their own highest role (an admin may manage any); nobody below
--     admin may change a person who holds admin or assistant (the same as "only below their own"); nobody removes their own
--     admin role, and the last admin can't be removed. The service role and a session without a user (migrations, jobs) are exempt.
--   * Audit: user_roles rows are audited as 'user_role'; a change to only user_profiles.role is no longer audited on its
--     own, since the user_roles rows are the intent.
--
-- The contract step (a later PR) stops reading the column, drops it and its check, and drops the sync triggers; see
-- docs/TODO.md, "Let a user hold several roles". Other readers of the column stay right meanwhile because the primary
-- role is the highest: a check for admin, for admin or assistant, or for any staff role holds for exactly the users who
-- hold one of them. The one that did not (can_own_care_plans, admin or community manager) is replaced here.

------------------------------------------------------------------------------------------------
-- The table
------------------------------------------------------------------------------------------------

CREATE TABLE public.user_roles (
  id text PRIMARY KEY DEFAULT public.new_id('urol'),
  user_id uuid NOT NULL REFERENCES public.user_profiles (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  UNIQUE (user_id, role)
);

COMMENT ON TABLE public.user_roles IS
  'The staff roles a user holds (a member holds none). What they may do is the union of the roles. user_profiles.role keeps the highest-priority one in step, until the contract step drops it. [id prefix: urol_]';

CREATE INDEX user_roles_role_idx ON public.user_roles (role);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.user_roles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_roles TO service_role;
GRANT SELECT ON public.user_roles TO supabase_auth_admin;

CREATE POLICY "Users read their own roles" ON public.user_roles
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
CREATE POLICY "Admins read all roles" ON public.user_roles
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins give roles" ON public.user_roles
  FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins take roles away" ON public.user_roles
  FOR DELETE TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Auth admin reads roles for the access token hook" ON public.user_roles
  FOR SELECT TO supabase_auth_admin USING (true);

-- One row per user per staff role they hold today: set-based (prod: a handful of staff accounts).
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, p.role
FROM public.user_profiles p
WHERE p.role IN ('admin', 'assistant', 'community_manager', 'conversion_specialist')
ON CONFLICT (user_id, role) DO NOTHING;

------------------------------------------------------------------------------------------------
-- Priority and the question every helper asks
------------------------------------------------------------------------------------------------

-- Priority, highest first. The primary role (user_profiles.role, the token's app_role) is the lowest rank a user holds.
-- Keep in step with STAFF_ROLES in src/lib/permissions.ts (tests/lib/user-roles-migration.test.ts compares them).
CREATE FUNCTION public.staff_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT array_position(ARRAY['admin', 'assistant', 'community_manager', 'conversion_specialist'], p_role);
$function$;

COMMENT ON FUNCTION public.staff_role_rank(text) IS
  'Priority of a staff role (1 = highest: admin, assistant, community manager, conversion specialist); null for anything else. The primary role is the lowest rank a user holds.';

-- Whether the user holds any of these roles, from user_roles or from the old user_profiles.role column (expand step:
-- both count). SECURITY DEFINER so policies can ask through RLS; closed to every client, called by the helper functions
-- below (owned by the same role) and the service role.
CREATE FUNCTION public.user_has_any_role(p_user uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = p_user AND role = ANY (p_roles))
      OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user AND role = ANY (p_roles));
$function$;

REVOKE ALL ON FUNCTION public.user_has_any_role(uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_any_role(uuid, text[]) TO service_role;

COMMENT ON FUNCTION public.user_has_any_role(uuid, text[]) IS
  'Whether a user holds any of these staff roles (user_roles, or the old user_profiles.role during the expand step). Not callable by clients; is_admin() and the other helpers use it.';

-- The helpers the policies use: same signatures, the question widened from "the column says" to "the column or a user_roles row says".
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  SELECT public.user_has_any_role(auth.uid(), ARRAY['admin']);
$function$;

CREATE OR REPLACE FUNCTION public.is_community_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  SELECT public.user_has_any_role(auth.uid(), ARRAY['community_manager']);
$function$;

CREATE OR REPLACE FUNCTION public.is_conversion_specialist()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $function$
  SELECT public.user_has_any_role(auth.uid(), ARRAY['conversion_specialist']);
$function$;

-- Who may own Hedgie Care plans (20270726000000 read the column: an assistant who is also a community manager must count).
CREATE OR REPLACE FUNCTION public.can_own_care_plans(p_user uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT (public.is_admin() OR public.is_community_manager())
     AND public.user_has_any_role(p_user, ARRAY['admin', 'community_manager']);
$function$;

------------------------------------------------------------------------------------------------
-- Staff classification (latest definitions, the role test reading both sources)
------------------------------------------------------------------------------------------------

-- audit_row_change(): the latest definition (20270930000000) with the staff test reading both role sources.
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
        WHEN public.user_has_any_role(uid, ARRAY['admin', 'assistant', 'community_manager', 'conversion_specialist']) THEN 'staff'
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

-- audit_entity_label(): the latest definition (20270322000100) with a label for a user_roles row: the account's sign-in email.
CREATE OR REPLACE FUNCTION public.audit_entity_label(entity text, subject jsonb)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
    SELECT left(COALESCE(
        CASE entity
            WHEN 'member_badge' THEN (SELECT b.name FROM badge_types b WHERE b.id = (subject ->> 'badge_type_id'))
            WHEN 'event' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'id'))
            WHEN 'event_attendee' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'event_photo' THEN (SELECT e.title FROM community_event_details e WHERE e.id = (subject ->> 'event_id'))
            WHEN 'segment_member' THEN (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id'))
            WHEN 'feature_flag' THEN subject ->> 'feature_key'
            WHEN 'user_feature_preview' THEN subject ->> 'feature_key'
            WHEN 'feature_flag_segment' THEN
                concat_ws(' · ', subject ->> 'feature_key', (SELECT s.name FROM segments s WHERE s.id = (subject ->> 'segment_id')))
            WHEN 'program_cohort' THEN
                concat_ws(' · ', (SELECT p.name FROM programs p WHERE p.id = (subject ->> 'program_id')), subject ->> 'name')
            WHEN 'program_enrollment' THEN
                (SELECT concat_ws(' · ', p.name, c.name) FROM program_cohorts c JOIN programs p ON p.id = c.program_id
                  WHERE c.id = (subject ->> 'cohort_id')::uuid)
            WHEN 'prickle_schedule' THEN
                concat_ws(' · ', (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id')), subject ->> 'month')
            WHEN 'prickle_host_vibe' THEN (SELECT t.name FROM prickle_types t WHERE t.id = (subject ->> 'type_id'))
            WHEN 'user_profile' THEN subject ->> 'email'
            WHEN 'user_role' THEN (SELECT up.email FROM user_profiles up WHERE up.id = (subject ->> 'user_id')::uuid)
            WHEN 'member_email_alias' THEN subject ->> 'alias_email'
            WHEN 'member_status_override' THEN subject ->> 'override_type'
            WHEN 'ignored_slack_user' THEN subject ->> 'user_id'
        END,
        NULLIF(subject ->> 'title', ''), NULLIF(subject ->> 'name', ''),
        NULLIF(subject ->> 'alias', ''), NULLIF(subject ->> 'award_name', '')), 120);
$function$;

-- staff_member_ids(): the latest definition (20270930000000), staff read from both role sources.
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
  WHERE public.user_has_any_role(p.id, ARRAY['admin', 'assistant', 'community_manager', 'conversion_specialist']);
$function$;

REVOKE ALL ON FUNCTION public.staff_member_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_member_ids() TO service_role;
COMMENT ON FUNCTION public.staff_member_ids() IS
  'The one definition of a staff member: members linked in the staff roster, and the members behind admin, assistant, community manager and conversion specialist accounts. Service role only.';

------------------------------------------------------------------------------------------------
-- Keeping user_profiles.role in step (the primary role) and the other way round (a direct write of the column)
------------------------------------------------------------------------------------------------

-- user_roles changed: the column becomes the highest-priority role the user holds, or 'member'.
CREATE FUNCTION public.sync_profile_role_from_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_primary text;
BEGIN
  SELECT r.role INTO v_primary
  FROM public.user_roles r
  WHERE r.user_id = v_user
  ORDER BY public.staff_role_rank(r.role)
  LIMIT 1;

  UPDATE public.user_profiles
     SET role = COALESCE(v_primary, 'member')
   WHERE id = v_user AND role IS DISTINCT FROM COALESCE(v_primary, 'member');
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_profile_role_from_user_roles() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_profile_role
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_from_user_roles();

-- Something wrote user_profiles.role directly (a legacy writer, a seed, a support edit): that means "exactly this role".
-- Only a direct write (trigger depth 0); the update the trigger above makes does not come back through here.
CREATE FUNCTION public.sync_user_roles_from_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF public.staff_role_rank(NEW.role) IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;
  DELETE FROM public.user_roles WHERE user_id = NEW.id AND role <> NEW.role;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.sync_user_roles_from_profile_role() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER sync_user_roles_insert
  AFTER INSERT ON public.user_profiles
  FOR EACH ROW WHEN (pg_trigger_depth() = 0)
  EXECUTE FUNCTION public.sync_user_roles_from_profile_role();

CREATE TRIGGER sync_user_roles_update
  AFTER UPDATE OF role ON public.user_profiles
  FOR EACH ROW WHEN (pg_trigger_depth() = 0 AND OLD.role IS DISTINCT FROM NEW.role)
  EXECUTE FUNCTION public.sync_user_roles_from_profile_role();

------------------------------------------------------------------------------------------------
-- Assigning: one call replaces the user's set, as the person who calls it
------------------------------------------------------------------------------------------------

CREATE FUNCTION public.set_user_roles(p_user uuid, p_roles text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_roles text[];
BEGIN
  -- Who may change what is decided row by row by the enforce_user_role_changes trigger (admin: any; assistant: only roles below
  -- assistant, on people below assistant); the service role (tests, jobs) is exempt.
  IF NOT (auth.role() = 'service_role'
          OR public.user_has_any_role(auth.uid(), ARRAY['admin', 'assistant'])) THEN
    RAISE EXCEPTION 'Only admins and assistants can change roles' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(DISTINCT r), '{}') INTO v_roles FROM unnest(p_roles) AS r WHERE r <> 'member';
  IF EXISTS (SELECT 1 FROM unnest(v_roles) AS r WHERE public.staff_role_rank(r) IS NULL) THEN
    RAISE EXCEPTION 'Unknown role' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_user) THEN
    RAISE EXCEPTION 'No such user' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_user AND NOT (role = ANY (v_roles));
  INSERT INTO public.user_roles (user_id, role)
  SELECT p_user, r FROM unnest(v_roles) AS r
  ON CONFLICT (user_id, role) DO NOTHING;
END;
$function$;

REVOKE ALL ON FUNCTION public.set_user_roles(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_roles(uuid, text[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.set_user_roles(uuid, text[]) IS
  'Replaces a user''s staff roles (member = none). Admin, assistant (only roles below assistant, on people below assistant) or the service role. The user_roles triggers enforce who may change what, write the Activity Log entries as the caller and keep user_profiles.role at the primary role.';

-- The lowest rank (highest role) a user holds, from user_roles or the old column; null for a member.
CREATE FUNCTION public.top_role_rank(p_user uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT min(public.staff_role_rank(r.role))
  FROM (
    SELECT role FROM public.user_roles WHERE user_id = p_user
    UNION
    SELECT role FROM public.user_profiles WHERE id = p_user
  ) AS r;
$function$;

REVOKE ALL ON FUNCTION public.top_role_rank(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.top_role_rank(uuid) TO service_role;

COMMENT ON FUNCTION public.top_role_rank(uuid) IS
  'The highest staff role a user holds as its rank (1 = admin), null for a member. Not callable by clients.';

-- Who may give or take away a role. An actor changes only roles strictly below their own highest role, and only on people
-- strictly below it (an admin changes any); nobody removes their own admin role; the last admin stays. A session with no user
-- (migrations, jobs) and the service role are exempt, and so is deleting an account (the roles go with it).
CREATE FUNCTION public.enforce_user_role_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_target uuid := COALESCE(NEW.user_id, OLD.user_id);
  v_role text := COALESCE(NEW.role, OLD.role);
  v_actor_rank integer;
  v_target_rank integer;
BEGIN
  IF v_actor IS NULL OR auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_target) THEN
    RETURN OLD;
  END IF;

  v_actor_rank := public.top_role_rank(v_actor);
  IF v_actor_rank IS NULL OR v_actor_rank > public.staff_role_rank('assistant') THEN
    RAISE EXCEPTION 'Only admins and assistants can change roles' USING ERRCODE = '42501';
  END IF;

  IF v_actor_rank > public.staff_role_rank('admin') THEN
    v_target_rank := public.top_role_rank(v_target);
    IF v_target_rank IS NOT NULL AND v_target_rank <= v_actor_rank THEN
      RAISE EXCEPTION 'An assistant can''t change the roles of an admin or another assistant' USING ERRCODE = '42501';
    END IF;
    IF public.staff_role_rank(v_role) <= v_actor_rank THEN
      RAISE EXCEPTION 'An assistant can only give or take away the community manager and conversion specialist roles' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' AND v_role = 'admin' THEN
    IF v_target = v_actor THEN
      RAISE EXCEPTION 'You can''t remove your own admin role; ask another admin' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.user_roles WHERE role = 'admin' AND user_id <> v_target
      UNION ALL
      SELECT 1 FROM public.user_profiles WHERE role = 'admin' AND id <> v_target
    ) THEN
      RAISE EXCEPTION 'You can''t remove the last admin' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

REVOKE ALL ON FUNCTION public.enforce_user_role_changes() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER enforce_user_role_changes
  BEFORE INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.enforce_user_role_changes();

------------------------------------------------------------------------------------------------
-- Audit: user_roles rows are the intent; a change of only user_profiles.role is their echo
------------------------------------------------------------------------------------------------

CREATE TRIGGER audit_row_change
  AFTER INSERT OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user_role', 'id');

DROP TRIGGER audit_row_change ON public.user_profiles;
CREATE TRIGGER audit_row_change
  AFTER INSERT OR DELETE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('user_profile', 'id');
CREATE TRIGGER audit_row_change_update
  AFTER UPDATE ON public.user_profiles
  FOR EACH ROW
  WHEN ((to_jsonb(OLD) - 'role' - 'updated_at') IS DISTINCT FROM (to_jsonb(NEW) - 'role' - 'updated_at'))
  EXECUTE FUNCTION public.audit_row_change('user_profile', 'id');

------------------------------------------------------------------------------------------------
-- Access token hook: app_roles (all staff roles, highest first) beside app_role (the primary role)
------------------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  claims jsonb := event -> 'claims';
  user_role text;
  user_roles_list jsonb;
BEGIN
  BEGIN
    SELECT p.role INTO user_role
    FROM public.user_profiles AS p
    WHERE p.id = (event ->> 'user_id')::uuid;

    SELECT COALESCE(jsonb_agg(u.role ORDER BY public.staff_role_rank(u.role)), '[]'::jsonb) INTO user_roles_list
    FROM (
      SELECT r.role FROM public.user_roles AS r WHERE r.user_id = (event ->> 'user_id')::uuid
      UNION
      SELECT p.role FROM public.user_profiles AS p
      WHERE p.id = (event ->> 'user_id')::uuid AND public.staff_role_rank(p.role) IS NOT NULL
    ) AS u;
  EXCEPTION WHEN OTHERS THEN
    -- A hook error blocks sign-in and token refresh for everyone. Never do that over a hint:
    -- leave the claims out and let the proxy refuse the admin area until a token carries them.
    RETURN event;
  END;

  claims := jsonb_set(claims, '{app_role}', COALESCE(to_jsonb(user_role), 'null'::jsonb));
  claims := jsonb_set(claims, '{app_roles}', user_roles_list);
  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

COMMENT ON FUNCTION public.custom_access_token_hook(jsonb) IS
  'Supabase Auth custom access token hook: adds app_role (user_profiles.role, the primary role) and app_roles (every staff role held, highest first). '
  'Optimistic hint for the proxy only; src/lib/admin-auth.ts re-checks the database.';

NOTIFY pgrst, 'reload schema';
