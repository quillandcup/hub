set lock_timeout = '5s';

-- Community manager: a member who is a semi-volunteer (paid in comps) and reads part of the admin
-- area, read-only (lib/staff-access.ts lists the pages). Every policy here is SELECT only; nothing
-- widens is_admin(), so writes stay admin-only.

-- Approved ban-drop-constraint ignore: the new check only adds a value, so no live code depends on the old one.
-- squawk-ignore ban-drop-constraint
ALTER TABLE public.user_profiles DROP CONSTRAINT user_profiles_role_check;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check CHECK (role IN ('admin', 'assistant', 'community_manager', 'member'));

CREATE OR REPLACE FUNCTION public.is_community_manager()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'community_manager'
  );
$$;

REVOKE ALL ON FUNCTION public.is_community_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_community_manager() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_community_manager() IS
  'True for a signed-in community manager (read-only staff). Use in SELECT policies only, beside is_admin().';

-- Silver and Local tables the community manager pages read.
CREATE POLICY "Community managers read members" ON public.members
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

CREATE POLICY "Community managers read member_activities" ON public.member_activities
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

CREATE POLICY "Community managers read member_name_aliases" ON public.member_name_aliases
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

CREATE POLICY "Community managers read member_email_aliases" ON public.member_email_aliases
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

CREATE POLICY "Community managers read member_hiatus_history" ON public.member_hiatus_history
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

CREATE POLICY "Community managers read ignored_zoom_appearances" ON public.ignored_zoom_appearances
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));

-- Staff notes on other members, never the ones written about their own member record.
CREATE POLICY "Community managers read notes on others" ON public.member_admin_notes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_community_manager())
    AND member_id IS DISTINCT FROM (SELECT public.current_member_id())
  );

-- Bronze: billing (resubscriptions, membership timeline), Zoom and Slack metadata. Slack message
-- text, files and raw payloads stay service-role only (column grants, slack_content_privacy).
CREATE POLICY "Community managers read kajabi_customers" ON bronze.kajabi_customers
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read kajabi_purchases" ON bronze.kajabi_purchases
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read kajabi_offers" ON bronze.kajabi_offers
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read stripe_customers" ON bronze.stripe_customers
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read stripe_subscriptions" ON bronze.stripe_subscriptions
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read zoom_attendees" ON bronze.zoom_attendees
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read zoom_meetings" ON bronze.zoom_meetings
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read slack_channels" ON bronze.slack_channels
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read slack_reactions" ON bronze.slack_reactions
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
CREATE POLICY "Community managers read slack_messages" ON bronze.slack_messages
  FOR SELECT TO authenticated USING ((SELECT public.is_community_manager()));
