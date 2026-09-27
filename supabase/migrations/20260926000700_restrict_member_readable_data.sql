-- Restrict what any signed-in member can READ.
--
-- Before: SELECT on members, every bronze table, member_activities and the admin note/history
-- tables was `auth.role() = 'authenticated'` (or `true`), so any member could pull other members'
-- emails, raw Kajabi payloads, Stripe customer ids, purchase/subscription history, Slack
-- messages, admin overrides, etc. straight from the REST API.
--
-- After:
--   1. members: a member reads only their OWN row (all columns); admins read everything.
--      Other members' public profile fields come from the new `member_directory` table.
--   2. bronze.*: admin-only reads. The few member pages that needed bronze data now read it
--      server-side with the service-role client, returning only non-sensitive derived values
--      (see the commit for the app changes).
--   3. member_status_overrides, member_join_date_overrides, member_hiatus_history,
--      admin_work_queue_completions, ambiguous_zoom_names: admin-only reads (no member page
--      reads them).
--   4. member_activities: own rows or admin (the only community-wide reader, Wheel of Wonder's
--      Slack-activity weighting, moved server-side to the service role).
--
-- Why a synced table rather than a view for the directory: a view that can see other members'
-- rows must bypass members' RLS, i.e. be security_invoker = false -- which the Supabase
-- Security Advisor reports as an ERROR (0010 security_definer_view), or read through a
-- SECURITY DEFINER function (a WARN, and opaque to the planner so every lookup scans every
-- member). A small table kept in sync by a trigger is plain RLS-protected data: filterable,
-- paginatable and indexable over PostgREST, with no definer function exposed to the API.
-- Embeds from other tables (e.g. prickles -> host name) use PostgREST computed relationships
-- (SECURITY INVOKER SQL functions below), since those tables' FKs point at members.
--
-- Idempotent: CREATE ... IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS throughout.

------------------------------------------------------------------------------------------------
-- 1. member_directory: public profile fields of every member.
------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.member_directory (
  id UUID PRIMARY KEY REFERENCES public.members(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT,
  photo_url TEXT,
  bio TEXT,
  instagram_url TEXT,
  facebook_url TEXT,
  twitter_url TEXT,
  joined_at TIMESTAMPTZ NOT NULL,
  first_joined_at DATE,
  most_recent_joined_at DATE,
  total_active_months INTEGER NOT NULL DEFAULT 0
);

COMMENT ON TABLE public.member_directory IS
  'DERIVED: public profile fields of every member (name, display name, photo, bio, socials, join dates, tenure), readable by any signed-in member. Maintained by the sync_member_directory trigger on members -- never write it directly. Private columns (email, raw_payload, stripe/kajabi ids, status, birthday, ...) stay on members, which members can only read for their own row.';

ALTER TABLE public.member_directory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read the member directory" ON public.member_directory;
CREATE POLICY "Authenticated users can read the member directory"
  ON public.member_directory FOR SELECT TO authenticated USING (true);

REVOKE ALL ON public.member_directory FROM anon;
GRANT SELECT ON public.member_directory TO authenticated;
GRANT ALL ON public.member_directory TO service_role;

-- Sync trigger. SECURITY DEFINER because whoever updates members (a member editing their own
-- name, an admin session, the service-role pipeline) must be able to refresh the directory row,
-- and there are deliberately no write policies on member_directory. It's a trigger function, so
-- it isn't callable over the API (EXECUTE revoked anyway).
CREATE OR REPLACE FUNCTION public.sync_member_directory()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.member_directory AS d (
    id, name, display_name, photo_url, bio, instagram_url, facebook_url, twitter_url,
    joined_at, first_joined_at, most_recent_joined_at, total_active_months
  ) VALUES (
    NEW.id, NEW.name, NEW.display_name, NEW.photo_url, NEW.bio, NEW.instagram_url,
    NEW.facebook_url, NEW.twitter_url, NEW.joined_at, NEW.first_joined_at,
    NEW.most_recent_joined_at, NEW.total_active_months
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    display_name = EXCLUDED.display_name,
    photo_url = EXCLUDED.photo_url,
    bio = EXCLUDED.bio,
    instagram_url = EXCLUDED.instagram_url,
    facebook_url = EXCLUDED.facebook_url,
    twitter_url = EXCLUDED.twitter_url,
    joined_at = EXCLUDED.joined_at,
    first_joined_at = EXCLUDED.first_joined_at,
    most_recent_joined_at = EXCLUDED.most_recent_joined_at,
    total_active_months = EXCLUDED.total_active_months
  WHERE (d.name, d.display_name, d.photo_url, d.bio, d.instagram_url, d.facebook_url,
         d.twitter_url, d.joined_at, d.first_joined_at, d.most_recent_joined_at,
         d.total_active_months)
        IS DISTINCT FROM
        (EXCLUDED.name, EXCLUDED.display_name, EXCLUDED.photo_url, EXCLUDED.bio,
         EXCLUDED.instagram_url, EXCLUDED.facebook_url, EXCLUDED.twitter_url, EXCLUDED.joined_at,
         EXCLUDED.first_joined_at, EXCLUDED.most_recent_joined_at, EXCLUDED.total_active_months);
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_member_directory() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_member_directory ON public.members;
CREATE TRIGGER sync_member_directory
  AFTER INSERT OR UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.sync_member_directory();
-- Deletes cascade via the FK.

-- Backfill (and repair any drift if re-run).
INSERT INTO public.member_directory (
  id, name, display_name, photo_url, bio, instagram_url, facebook_url, twitter_url,
  joined_at, first_joined_at, most_recent_joined_at, total_active_months
)
SELECT id, name, display_name, photo_url, bio, instagram_url, facebook_url, twitter_url,
       joined_at, first_joined_at, most_recent_joined_at, total_active_months
FROM public.members
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  display_name = EXCLUDED.display_name,
  photo_url = EXCLUDED.photo_url,
  bio = EXCLUDED.bio,
  instagram_url = EXCLUDED.instagram_url,
  facebook_url = EXCLUDED.facebook_url,
  twitter_url = EXCLUDED.twitter_url,
  joined_at = EXCLUDED.joined_at,
  first_joined_at = EXCLUDED.first_joined_at,
  most_recent_joined_at = EXCLUDED.most_recent_joined_at,
  total_active_months = EXCLUDED.total_active_months;

-- Computed relationships (PostgREST): let member-session queries keep embedding a member's
-- public fields, e.g. prickles?select=host:prickle_host(id,name). SECURITY INVOKER + inlinable
-- SQL, so they're index lookups on member_directory under the caller's own RLS.
CREATE OR REPLACE FUNCTION public.prickle_host(public.prickles)
RETURNS SETOF public.member_directory ROWS 1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM public.member_directory WHERE id = $1.host $$;

CREATE OR REPLACE FUNCTION public.attendance_member(public.prickle_attendance)
RETURNS SETOF public.member_directory ROWS 1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM public.member_directory WHERE id = $1.member_id $$;

CREATE OR REPLACE FUNCTION public.book_member(public.member_books)
RETURNS SETOF public.member_directory ROWS 1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM public.member_directory WHERE id = $1.member_id $$;

CREATE OR REPLACE FUNCTION public.schedule_host(public.prickle_schedules)
RETURNS SETOF public.member_directory ROWS 1
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = ''
AS $$ SELECT * FROM public.member_directory WHERE id = $1.host_id $$;

REVOKE EXECUTE ON FUNCTION public.prickle_host(public.prickles) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.attendance_member(public.prickle_attendance) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.book_member(public.member_books) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.schedule_host(public.prickle_schedules) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prickle_host(public.prickles) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attendance_member(public.prickle_attendance) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.book_member(public.member_books) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.schedule_host(public.prickle_schedules) TO authenticated, service_role;

------------------------------------------------------------------------------------------------
-- 2. members: own row or admin. "Own" matches lib/sudo.ts getEffectiveIdentity exactly
--    (members.user_id = auth user, else members.email = the JWT email). Existing policies on
--    other tables that subquery `members WHERE email = auth.email()` only ever need the
--    caller's own row, so they keep working.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view members" ON public.members;
DROP POLICY IF EXISTS "View own member row, admins view all" ON public.members;
CREATE POLICY "View own member row, admins view all"
  ON public.members FOR SELECT TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR email = (SELECT auth.jwt() ->> 'email')
    OR (SELECT public.is_admin())
  );

------------------------------------------------------------------------------------------------
-- 3. bronze: admin-only reads.
------------------------------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'calendar_events', 'kajabi_contacts', 'kajabi_customers', 'kajabi_members', 'kajabi_offers',
    'kajabi_purchases', 'slack_channels', 'slack_messages', 'slack_reactions', 'slack_users',
    'stripe_customers', 'stripe_products', 'stripe_subscriptions', 'subscription_history',
    'zoom_attendees', 'zoom_meetings'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON bronze.%I', 'Authenticated users can view ' || t, t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON bronze.%I', 'Admins can read ' || t, t);
    EXECUTE format(
      'CREATE POLICY %I ON bronze.%I FOR SELECT TO authenticated USING ((SELECT public.is_admin()))',
      'Admins can read ' || t, t
    );
  END LOOP;
END $$;

------------------------------------------------------------------------------------------------
-- 4. Admin notes / history: admin-only reads.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow authenticated users to read member status overrides" ON public.member_status_overrides;
DROP POLICY IF EXISTS "Admins can read member_status_overrides" ON public.member_status_overrides;
CREATE POLICY "Admins can read member_status_overrides" ON public.member_status_overrides
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Allow authenticated users to read member join date overrides" ON public.member_join_date_overrides;
DROP POLICY IF EXISTS "Admins can read member_join_date_overrides" ON public.member_join_date_overrides;
CREATE POLICY "Admins can read member_join_date_overrides" ON public.member_join_date_overrides
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Authenticated users can view member_hiatus_history" ON public.member_hiatus_history;
DROP POLICY IF EXISTS "Admins can read member_hiatus_history" ON public.member_hiatus_history;
CREATE POLICY "Admins can read member_hiatus_history" ON public.member_hiatus_history
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Authenticated users can view admin_work_queue_completions" ON public.admin_work_queue_completions;
DROP POLICY IF EXISTS "Admins can read admin_work_queue_completions" ON public.admin_work_queue_completions;
CREATE POLICY "Admins can read admin_work_queue_completions" ON public.admin_work_queue_completions
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Authenticated users can view ambiguous_zoom_names" ON public.ambiguous_zoom_names;
DROP POLICY IF EXISTS "Admins can read ambiguous_zoom_names" ON public.ambiguous_zoom_names;
CREATE POLICY "Admins can read ambiguous_zoom_names" ON public.ambiguous_zoom_names
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- 5. member_activities: own rows or admin.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can view member_activities" ON public.member_activities;
DROP POLICY IF EXISTS "View own activities, admins view all" ON public.member_activities;
CREATE POLICY "View own activities, admins view all" ON public.member_activities
  FOR SELECT TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
