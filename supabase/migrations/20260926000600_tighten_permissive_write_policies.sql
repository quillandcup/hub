-- Tighten write policies that let ANY signed-in user write directly via PostgREST.
--
-- Audit of pg_policies (public + bronze, both exposed per supabase/config.toml api.schemas)
-- found ~45 tables whose INSERT/UPDATE/DELETE/ALL policies checked only
-- `auth.role() = 'authenticated'` or `true` -- e.g. dismissed_duplicate_groups' "Admins can ..."
-- policies were USING/WITH CHECK (true). The app's own gates (requireAdmin in API routes, admin
-- checks in server actions) don't stop a member calling the REST API with their own JWT.
--
-- Who legitimately writes these tables (grep of app/ lib/ components/):
--   * requireAdmin API routes / admin server actions -> an admin's own session (role
--     authenticated, is_admin() true) or service role (tests, cron) -- service role bypasses RLS.
--   * webhooks, lib/processing/trigger.ts, lib/kajabi/contact-refresh.ts, writing nudges ->
--     service role (anon never had write access, so anything working without a session already
--     used the service role).
--   * Member self-service (user session, see the owner-scoped section below):
--       member_activities       app/(member)/projects/actions.ts (log/delete progress),
--                               app/(member)/my-prickles/commitment-actions.ts
--       members                 app/(member)/settings/identityActions.ts (name, birthday only)
--       prickle_host_vibes      app/(member)/prickle-picker/actions.ts (upsert own vibe)
--       wheel_of_wonder_matches app/(member)/wheel-of-wonder/actions.ts (insert own spin)
--   Sudo: an admin browsing as a member still writes under the admin's own Postgres session, so
--   the is_admin() branch covers it.
--
-- No custom triggers exist on these tables (only update_updated_at_column), so nothing writes
-- them indirectly under a member's role. All reads are left as they were, except outreach_*
-- and dismissed_duplicate_groups (admin-only readers, see the end).
--
-- Idempotent: every CREATE POLICY is preceded by DROP POLICY IF EXISTS of the old and new names.

------------------------------------------------------------------------------------------------
-- 1. Admin-only writes. Only the commands that previously existed are recreated.
--    For FOR ALL policies that were a table's only SELECT grant (bronze.slack_*,
--    subscription_history, zoom_meetings), an equivalent SELECT policy is recreated so reads
--    don't change.
------------------------------------------------------------------------------------------------

-- bronze.calendar_events
DROP POLICY IF EXISTS "Authenticated users can modify calendar_events" ON bronze.calendar_events;
DROP POLICY IF EXISTS "Admins can insert calendar_events" ON bronze.calendar_events;
CREATE POLICY "Admins can insert calendar_events" ON bronze.calendar_events FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update calendar_events" ON bronze.calendar_events;
CREATE POLICY "Admins can update calendar_events" ON bronze.calendar_events FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete calendar_events" ON bronze.calendar_events;
CREATE POLICY "Admins can delete calendar_events" ON bronze.calendar_events FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.kajabi_contacts
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_contacts" ON bronze.kajabi_contacts;
DROP POLICY IF EXISTS "Admins can insert kajabi_contacts" ON bronze.kajabi_contacts;
CREATE POLICY "Admins can insert kajabi_contacts" ON bronze.kajabi_contacts FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update kajabi_contacts" ON bronze.kajabi_contacts;
CREATE POLICY "Admins can update kajabi_contacts" ON bronze.kajabi_contacts FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete kajabi_contacts" ON bronze.kajabi_contacts;
CREATE POLICY "Admins can delete kajabi_contacts" ON bronze.kajabi_contacts FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.kajabi_customers
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_customers" ON bronze.kajabi_customers;
DROP POLICY IF EXISTS "Admins can insert kajabi_customers" ON bronze.kajabi_customers;
CREATE POLICY "Admins can insert kajabi_customers" ON bronze.kajabi_customers FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update kajabi_customers" ON bronze.kajabi_customers;
CREATE POLICY "Admins can update kajabi_customers" ON bronze.kajabi_customers FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete kajabi_customers" ON bronze.kajabi_customers;
CREATE POLICY "Admins can delete kajabi_customers" ON bronze.kajabi_customers FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.kajabi_members
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_members" ON bronze.kajabi_members;
DROP POLICY IF EXISTS "Admins can insert kajabi_members" ON bronze.kajabi_members;
CREATE POLICY "Admins can insert kajabi_members" ON bronze.kajabi_members FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update kajabi_members" ON bronze.kajabi_members;
CREATE POLICY "Admins can update kajabi_members" ON bronze.kajabi_members FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete kajabi_members" ON bronze.kajabi_members;
CREATE POLICY "Admins can delete kajabi_members" ON bronze.kajabi_members FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.kajabi_offers
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_offers" ON bronze.kajabi_offers;
DROP POLICY IF EXISTS "Admins can insert kajabi_offers" ON bronze.kajabi_offers;
CREATE POLICY "Admins can insert kajabi_offers" ON bronze.kajabi_offers FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update kajabi_offers" ON bronze.kajabi_offers;
CREATE POLICY "Admins can update kajabi_offers" ON bronze.kajabi_offers FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete kajabi_offers" ON bronze.kajabi_offers;
CREATE POLICY "Admins can delete kajabi_offers" ON bronze.kajabi_offers FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.kajabi_purchases
DROP POLICY IF EXISTS "Authenticated users can modify kajabi_purchases" ON bronze.kajabi_purchases;
DROP POLICY IF EXISTS "Admins can insert kajabi_purchases" ON bronze.kajabi_purchases;
CREATE POLICY "Admins can insert kajabi_purchases" ON bronze.kajabi_purchases FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update kajabi_purchases" ON bronze.kajabi_purchases;
CREATE POLICY "Admins can update kajabi_purchases" ON bronze.kajabi_purchases FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete kajabi_purchases" ON bronze.kajabi_purchases;
CREATE POLICY "Admins can delete kajabi_purchases" ON bronze.kajabi_purchases FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.slack_channels
DROP POLICY IF EXISTS "Authenticated users can modify slack_channels" ON bronze.slack_channels;
DROP POLICY IF EXISTS "Authenticated users can view slack_channels" ON bronze.slack_channels;
CREATE POLICY "Authenticated users can view slack_channels" ON bronze.slack_channels FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert slack_channels" ON bronze.slack_channels;
CREATE POLICY "Admins can insert slack_channels" ON bronze.slack_channels FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update slack_channels" ON bronze.slack_channels;
CREATE POLICY "Admins can update slack_channels" ON bronze.slack_channels FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete slack_channels" ON bronze.slack_channels;
CREATE POLICY "Admins can delete slack_channels" ON bronze.slack_channels FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.slack_messages
DROP POLICY IF EXISTS "Authenticated users can modify slack_messages" ON bronze.slack_messages;
DROP POLICY IF EXISTS "Authenticated users can view slack_messages" ON bronze.slack_messages;
CREATE POLICY "Authenticated users can view slack_messages" ON bronze.slack_messages FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert slack_messages" ON bronze.slack_messages;
CREATE POLICY "Admins can insert slack_messages" ON bronze.slack_messages FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update slack_messages" ON bronze.slack_messages;
CREATE POLICY "Admins can update slack_messages" ON bronze.slack_messages FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete slack_messages" ON bronze.slack_messages;
CREATE POLICY "Admins can delete slack_messages" ON bronze.slack_messages FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.slack_reactions
DROP POLICY IF EXISTS "Authenticated users can modify slack_reactions" ON bronze.slack_reactions;
DROP POLICY IF EXISTS "Authenticated users can view slack_reactions" ON bronze.slack_reactions;
CREATE POLICY "Authenticated users can view slack_reactions" ON bronze.slack_reactions FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert slack_reactions" ON bronze.slack_reactions;
CREATE POLICY "Admins can insert slack_reactions" ON bronze.slack_reactions FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update slack_reactions" ON bronze.slack_reactions;
CREATE POLICY "Admins can update slack_reactions" ON bronze.slack_reactions FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete slack_reactions" ON bronze.slack_reactions;
CREATE POLICY "Admins can delete slack_reactions" ON bronze.slack_reactions FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.slack_users
DROP POLICY IF EXISTS "Authenticated users can modify slack_users" ON bronze.slack_users;
DROP POLICY IF EXISTS "Authenticated users can view slack_users" ON bronze.slack_users;
CREATE POLICY "Authenticated users can view slack_users" ON bronze.slack_users FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert slack_users" ON bronze.slack_users;
CREATE POLICY "Admins can insert slack_users" ON bronze.slack_users FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update slack_users" ON bronze.slack_users;
CREATE POLICY "Admins can update slack_users" ON bronze.slack_users FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete slack_users" ON bronze.slack_users;
CREATE POLICY "Admins can delete slack_users" ON bronze.slack_users FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.stripe_customers
DROP POLICY IF EXISTS "Authenticated users can modify stripe_customers" ON bronze.stripe_customers;
DROP POLICY IF EXISTS "Admins can insert stripe_customers" ON bronze.stripe_customers;
CREATE POLICY "Admins can insert stripe_customers" ON bronze.stripe_customers FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update stripe_customers" ON bronze.stripe_customers;
CREATE POLICY "Admins can update stripe_customers" ON bronze.stripe_customers FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete stripe_customers" ON bronze.stripe_customers;
CREATE POLICY "Admins can delete stripe_customers" ON bronze.stripe_customers FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.stripe_products
DROP POLICY IF EXISTS "Authenticated users can modify stripe_products" ON bronze.stripe_products;
DROP POLICY IF EXISTS "Admins can insert stripe_products" ON bronze.stripe_products;
CREATE POLICY "Admins can insert stripe_products" ON bronze.stripe_products FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update stripe_products" ON bronze.stripe_products;
CREATE POLICY "Admins can update stripe_products" ON bronze.stripe_products FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete stripe_products" ON bronze.stripe_products;
CREATE POLICY "Admins can delete stripe_products" ON bronze.stripe_products FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.stripe_subscriptions
DROP POLICY IF EXISTS "Authenticated users can modify stripe_subscriptions" ON bronze.stripe_subscriptions;
DROP POLICY IF EXISTS "Admins can insert stripe_subscriptions" ON bronze.stripe_subscriptions;
CREATE POLICY "Admins can insert stripe_subscriptions" ON bronze.stripe_subscriptions FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update stripe_subscriptions" ON bronze.stripe_subscriptions;
CREATE POLICY "Admins can update stripe_subscriptions" ON bronze.stripe_subscriptions FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete stripe_subscriptions" ON bronze.stripe_subscriptions;
CREATE POLICY "Admins can delete stripe_subscriptions" ON bronze.stripe_subscriptions FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.subscription_history
DROP POLICY IF EXISTS "Authenticated users can modify subscription_history" ON bronze.subscription_history;
DROP POLICY IF EXISTS "Authenticated users can view subscription_history" ON bronze.subscription_history;
CREATE POLICY "Authenticated users can view subscription_history" ON bronze.subscription_history FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert subscription_history" ON bronze.subscription_history;
CREATE POLICY "Admins can insert subscription_history" ON bronze.subscription_history FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update subscription_history" ON bronze.subscription_history;
CREATE POLICY "Admins can update subscription_history" ON bronze.subscription_history FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete subscription_history" ON bronze.subscription_history;
CREATE POLICY "Admins can delete subscription_history" ON bronze.subscription_history FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.zoom_attendees
DROP POLICY IF EXISTS "Authenticated users can modify zoom_attendees" ON bronze.zoom_attendees;
DROP POLICY IF EXISTS "Admins can insert zoom_attendees" ON bronze.zoom_attendees;
CREATE POLICY "Admins can insert zoom_attendees" ON bronze.zoom_attendees FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update zoom_attendees" ON bronze.zoom_attendees;
CREATE POLICY "Admins can update zoom_attendees" ON bronze.zoom_attendees FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete zoom_attendees" ON bronze.zoom_attendees;
CREATE POLICY "Admins can delete zoom_attendees" ON bronze.zoom_attendees FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- bronze.zoom_meetings
DROP POLICY IF EXISTS "Authenticated users can modify zoom_meetings" ON bronze.zoom_meetings;
DROP POLICY IF EXISTS "Authenticated users can view zoom_meetings" ON bronze.zoom_meetings;
CREATE POLICY "Authenticated users can view zoom_meetings" ON bronze.zoom_meetings FOR SELECT USING (auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Admins can insert zoom_meetings" ON bronze.zoom_meetings;
CREATE POLICY "Admins can insert zoom_meetings" ON bronze.zoom_meetings FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update zoom_meetings" ON bronze.zoom_meetings;
CREATE POLICY "Admins can update zoom_meetings" ON bronze.zoom_meetings FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete zoom_meetings" ON bronze.zoom_meetings;
CREATE POLICY "Admins can delete zoom_meetings" ON bronze.zoom_meetings FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.admin_work_queue_completions
DROP POLICY IF EXISTS "Authenticated users can modify admin_work_queue_completions" ON public.admin_work_queue_completions;
DROP POLICY IF EXISTS "Admins can insert admin_work_queue_completions" ON public.admin_work_queue_completions;
CREATE POLICY "Admins can insert admin_work_queue_completions" ON public.admin_work_queue_completions FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update admin_work_queue_completions" ON public.admin_work_queue_completions;
CREATE POLICY "Admins can update admin_work_queue_completions" ON public.admin_work_queue_completions FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete admin_work_queue_completions" ON public.admin_work_queue_completions;
CREATE POLICY "Admins can delete admin_work_queue_completions" ON public.admin_work_queue_completions FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.ambiguous_zoom_names
DROP POLICY IF EXISTS "Authenticated users can modify ambiguous_zoom_names" ON public.ambiguous_zoom_names;
DROP POLICY IF EXISTS "Admins can insert ambiguous_zoom_names" ON public.ambiguous_zoom_names;
CREATE POLICY "Admins can insert ambiguous_zoom_names" ON public.ambiguous_zoom_names FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update ambiguous_zoom_names" ON public.ambiguous_zoom_names;
CREATE POLICY "Admins can update ambiguous_zoom_names" ON public.ambiguous_zoom_names FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete ambiguous_zoom_names" ON public.ambiguous_zoom_names;
CREATE POLICY "Admins can delete ambiguous_zoom_names" ON public.ambiguous_zoom_names FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.ignored_slack_users
DROP POLICY IF EXISTS "Authenticated users can modify ignored_slack_users" ON public.ignored_slack_users;
DROP POLICY IF EXISTS "Admins can insert ignored_slack_users" ON public.ignored_slack_users;
CREATE POLICY "Admins can insert ignored_slack_users" ON public.ignored_slack_users FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update ignored_slack_users" ON public.ignored_slack_users;
CREATE POLICY "Admins can update ignored_slack_users" ON public.ignored_slack_users FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete ignored_slack_users" ON public.ignored_slack_users;
CREATE POLICY "Admins can delete ignored_slack_users" ON public.ignored_slack_users FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.ignored_zoom_names
DROP POLICY IF EXISTS "Authenticated users can modify ignored_zoom_names" ON public.ignored_zoom_names;
DROP POLICY IF EXISTS "Admins can insert ignored_zoom_names" ON public.ignored_zoom_names;
CREATE POLICY "Admins can insert ignored_zoom_names" ON public.ignored_zoom_names FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update ignored_zoom_names" ON public.ignored_zoom_names;
CREATE POLICY "Admins can update ignored_zoom_names" ON public.ignored_zoom_names FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete ignored_zoom_names" ON public.ignored_zoom_names;
CREATE POLICY "Admins can delete ignored_zoom_names" ON public.ignored_zoom_names FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_engagement
DROP POLICY IF EXISTS "Authenticated users can modify member_engagement" ON public.member_engagement;
DROP POLICY IF EXISTS "Admins can insert member_engagement" ON public.member_engagement;
CREATE POLICY "Admins can insert member_engagement" ON public.member_engagement FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_engagement" ON public.member_engagement;
CREATE POLICY "Admins can update member_engagement" ON public.member_engagement FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_engagement" ON public.member_engagement;
CREATE POLICY "Admins can delete member_engagement" ON public.member_engagement FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_hiatus_history
DROP POLICY IF EXISTS "Authenticated users can modify member_hiatus_history" ON public.member_hiatus_history;
DROP POLICY IF EXISTS "Admins can insert member_hiatus_history" ON public.member_hiatus_history;
CREATE POLICY "Admins can insert member_hiatus_history" ON public.member_hiatus_history FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_hiatus_history" ON public.member_hiatus_history;
CREATE POLICY "Admins can update member_hiatus_history" ON public.member_hiatus_history FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_hiatus_history" ON public.member_hiatus_history;
CREATE POLICY "Admins can delete member_hiatus_history" ON public.member_hiatus_history FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_metrics
DROP POLICY IF EXISTS "Authenticated users can modify member_metrics" ON public.member_metrics;
DROP POLICY IF EXISTS "Admins can insert member_metrics" ON public.member_metrics;
CREATE POLICY "Admins can insert member_metrics" ON public.member_metrics FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_metrics" ON public.member_metrics;
CREATE POLICY "Admins can update member_metrics" ON public.member_metrics FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_metrics" ON public.member_metrics;
CREATE POLICY "Admins can delete member_metrics" ON public.member_metrics FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.prickle_attendance
DROP POLICY IF EXISTS "Authenticated and service role can modify attendance" ON public.prickle_attendance;
DROP POLICY IF EXISTS "Admins can insert prickle_attendance" ON public.prickle_attendance;
CREATE POLICY "Admins can insert prickle_attendance" ON public.prickle_attendance FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update prickle_attendance" ON public.prickle_attendance;
CREATE POLICY "Admins can update prickle_attendance" ON public.prickle_attendance FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete prickle_attendance" ON public.prickle_attendance;
CREATE POLICY "Admins can delete prickle_attendance" ON public.prickle_attendance FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.prickle_popularity
DROP POLICY IF EXISTS "Authenticated users can modify prickle_popularity" ON public.prickle_popularity;
DROP POLICY IF EXISTS "Admins can insert prickle_popularity" ON public.prickle_popularity;
CREATE POLICY "Admins can insert prickle_popularity" ON public.prickle_popularity FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update prickle_popularity" ON public.prickle_popularity;
CREATE POLICY "Admins can update prickle_popularity" ON public.prickle_popularity FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete prickle_popularity" ON public.prickle_popularity;
CREATE POLICY "Admins can delete prickle_popularity" ON public.prickle_popularity FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.prickle_types
DROP POLICY IF EXISTS "Authenticated users can modify prickle_types" ON public.prickle_types;
DROP POLICY IF EXISTS "Admins can insert prickle_types" ON public.prickle_types;
CREATE POLICY "Admins can insert prickle_types" ON public.prickle_types FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update prickle_types" ON public.prickle_types;
CREATE POLICY "Admins can update prickle_types" ON public.prickle_types FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete prickle_types" ON public.prickle_types;
CREATE POLICY "Admins can delete prickle_types" ON public.prickle_types FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.prickles
DROP POLICY IF EXISTS "Authenticated users can modify prickles" ON public.prickles;
DROP POLICY IF EXISTS "Admins can insert prickles" ON public.prickles;
CREATE POLICY "Admins can insert prickles" ON public.prickles FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update prickles" ON public.prickles;
CREATE POLICY "Admins can update prickles" ON public.prickles FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete prickles" ON public.prickles;
CREATE POLICY "Admins can delete prickles" ON public.prickles FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.staff
DROP POLICY IF EXISTS "Authenticated users can modify staff" ON public.staff;
DROP POLICY IF EXISTS "Admins can insert staff" ON public.staff;
CREATE POLICY "Admins can insert staff" ON public.staff FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update staff" ON public.staff;
CREATE POLICY "Admins can update staff" ON public.staff FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete staff" ON public.staff;
CREATE POLICY "Admins can delete staff" ON public.staff FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.unmatched_calendar_events
DROP POLICY IF EXISTS "Authenticated users can modify unmatched_calendar_events" ON public.unmatched_calendar_events;
DROP POLICY IF EXISTS "Admins can insert unmatched_calendar_events" ON public.unmatched_calendar_events;
CREATE POLICY "Admins can insert unmatched_calendar_events" ON public.unmatched_calendar_events FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update unmatched_calendar_events" ON public.unmatched_calendar_events;
CREATE POLICY "Admins can update unmatched_calendar_events" ON public.unmatched_calendar_events FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete unmatched_calendar_events" ON public.unmatched_calendar_events;
CREATE POLICY "Admins can delete unmatched_calendar_events" ON public.unmatched_calendar_events FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.dismissed_duplicate_groups
DROP POLICY IF EXISTS "Admins can dismiss groups" ON public.dismissed_duplicate_groups;
DROP POLICY IF EXISTS "Admins can undismiss groups" ON public.dismissed_duplicate_groups;
DROP POLICY IF EXISTS "Admins can insert dismissed_duplicate_groups" ON public.dismissed_duplicate_groups;
CREATE POLICY "Admins can insert dismissed_duplicate_groups" ON public.dismissed_duplicate_groups FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete dismissed_duplicate_groups" ON public.dismissed_duplicate_groups;
CREATE POLICY "Admins can delete dismissed_duplicate_groups" ON public.dismissed_duplicate_groups FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.feature_flag_segments
DROP POLICY IF EXISTS "Allow authenticated insert feature_flag_segments" ON public.feature_flag_segments;
DROP POLICY IF EXISTS "Allow authenticated delete feature_flag_segments" ON public.feature_flag_segments;
DROP POLICY IF EXISTS "Admins can insert feature_flag_segments" ON public.feature_flag_segments;
CREATE POLICY "Admins can insert feature_flag_segments" ON public.feature_flag_segments FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete feature_flag_segments" ON public.feature_flag_segments;
CREATE POLICY "Admins can delete feature_flag_segments" ON public.feature_flag_segments FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.feature_flags
DROP POLICY IF EXISTS "Allow authenticated insert feature_flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Allow authenticated update feature_flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Allow authenticated delete feature_flags" ON public.feature_flags;
DROP POLICY IF EXISTS "Admins can insert feature_flags" ON public.feature_flags;
CREATE POLICY "Admins can insert feature_flags" ON public.feature_flags FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update feature_flags" ON public.feature_flags;
CREATE POLICY "Admins can update feature_flags" ON public.feature_flags FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete feature_flags" ON public.feature_flags;
CREATE POLICY "Admins can delete feature_flags" ON public.feature_flags FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_join_date_overrides
DROP POLICY IF EXISTS "Allow authenticated users to insert member join date overrides" ON public.member_join_date_overrides;
DROP POLICY IF EXISTS "Allow authenticated users to update member join date overrides" ON public.member_join_date_overrides;
DROP POLICY IF EXISTS "Allow authenticated users to delete member join date overrides" ON public.member_join_date_overrides;
DROP POLICY IF EXISTS "Admins can insert member_join_date_overrides" ON public.member_join_date_overrides;
CREATE POLICY "Admins can insert member_join_date_overrides" ON public.member_join_date_overrides FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_join_date_overrides" ON public.member_join_date_overrides;
CREATE POLICY "Admins can update member_join_date_overrides" ON public.member_join_date_overrides FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_join_date_overrides" ON public.member_join_date_overrides;
CREATE POLICY "Admins can delete member_join_date_overrides" ON public.member_join_date_overrides FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_program_enrollments
DROP POLICY IF EXISTS "Allow authenticated users to insert member program enrollments" ON public.member_program_enrollments;
DROP POLICY IF EXISTS "Allow authenticated users to update member program enrollments" ON public.member_program_enrollments;
DROP POLICY IF EXISTS "Allow authenticated users to delete member program enrollments" ON public.member_program_enrollments;
DROP POLICY IF EXISTS "Admins can insert member_program_enrollments" ON public.member_program_enrollments;
CREATE POLICY "Admins can insert member_program_enrollments" ON public.member_program_enrollments FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_program_enrollments" ON public.member_program_enrollments;
CREATE POLICY "Admins can update member_program_enrollments" ON public.member_program_enrollments FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_program_enrollments" ON public.member_program_enrollments;
CREATE POLICY "Admins can delete member_program_enrollments" ON public.member_program_enrollments FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.member_status_overrides
DROP POLICY IF EXISTS "Allow authenticated users to insert member status overrides" ON public.member_status_overrides;
DROP POLICY IF EXISTS "Allow authenticated users to update member status overrides" ON public.member_status_overrides;
DROP POLICY IF EXISTS "Allow authenticated users to delete member status overrides" ON public.member_status_overrides;
DROP POLICY IF EXISTS "Admins can insert member_status_overrides" ON public.member_status_overrides;
CREATE POLICY "Admins can insert member_status_overrides" ON public.member_status_overrides FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update member_status_overrides" ON public.member_status_overrides;
CREATE POLICY "Admins can update member_status_overrides" ON public.member_status_overrides FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete member_status_overrides" ON public.member_status_overrides;
CREATE POLICY "Admins can delete member_status_overrides" ON public.member_status_overrides FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.program_cohorts
DROP POLICY IF EXISTS "Allow authenticated users to insert program cohorts" ON public.program_cohorts;
DROP POLICY IF EXISTS "Allow authenticated users to update program cohorts" ON public.program_cohorts;
DROP POLICY IF EXISTS "Allow authenticated users to delete program cohorts" ON public.program_cohorts;
DROP POLICY IF EXISTS "Admins can insert program_cohorts" ON public.program_cohorts;
CREATE POLICY "Admins can insert program_cohorts" ON public.program_cohorts FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update program_cohorts" ON public.program_cohorts;
CREATE POLICY "Admins can update program_cohorts" ON public.program_cohorts FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete program_cohorts" ON public.program_cohorts;
CREATE POLICY "Admins can delete program_cohorts" ON public.program_cohorts FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.programs
DROP POLICY IF EXISTS "Allow authenticated users to insert programs" ON public.programs;
DROP POLICY IF EXISTS "Allow authenticated users to update programs" ON public.programs;
DROP POLICY IF EXISTS "Allow authenticated users to delete programs" ON public.programs;
DROP POLICY IF EXISTS "Admins can insert programs" ON public.programs;
CREATE POLICY "Admins can insert programs" ON public.programs FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update programs" ON public.programs;
CREATE POLICY "Admins can update programs" ON public.programs FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete programs" ON public.programs;
CREATE POLICY "Admins can delete programs" ON public.programs FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.outreach_leads
DROP POLICY IF EXISTS "Allow authenticated users to insert outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Allow authenticated users to update outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Allow authenticated users to delete outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Admins can insert outreach_leads" ON public.outreach_leads;
CREATE POLICY "Admins can insert outreach_leads" ON public.outreach_leads FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update outreach_leads" ON public.outreach_leads;
CREATE POLICY "Admins can update outreach_leads" ON public.outreach_leads FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete outreach_leads" ON public.outreach_leads;
CREATE POLICY "Admins can delete outreach_leads" ON public.outreach_leads FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.outreach_touches
DROP POLICY IF EXISTS "Allow authenticated users to insert outreach_touches" ON public.outreach_touches;
DROP POLICY IF EXISTS "Admins can insert outreach_touches" ON public.outreach_touches;
CREATE POLICY "Admins can insert outreach_touches" ON public.outreach_touches FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));

-- public.segment_members
DROP POLICY IF EXISTS "Allow authenticated insert segment_members" ON public.segment_members;
DROP POLICY IF EXISTS "Allow authenticated delete segment_members" ON public.segment_members;
DROP POLICY IF EXISTS "Admins can insert segment_members" ON public.segment_members;
CREATE POLICY "Admins can insert segment_members" ON public.segment_members FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete segment_members" ON public.segment_members;
CREATE POLICY "Admins can delete segment_members" ON public.segment_members FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

-- public.segments
DROP POLICY IF EXISTS "Allow authenticated insert segments" ON public.segments;
DROP POLICY IF EXISTS "Allow authenticated update segments" ON public.segments;
DROP POLICY IF EXISTS "Allow authenticated delete segments" ON public.segments;
DROP POLICY IF EXISTS "Admins can insert segments" ON public.segments;
CREATE POLICY "Admins can insert segments" ON public.segments FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can update segments" ON public.segments;
CREATE POLICY "Admins can update segments" ON public.segments FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
DROP POLICY IF EXISTS "Admins can delete segments" ON public.segments;
CREATE POLICY "Admins can delete segments" ON public.segments FOR DELETE TO authenticated USING ((SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- 2. Owner-or-admin writes for member self-service tables. Ownership uses current_member_id()
--    (members.user_id = auth.uid(), falling back to JWT email), the same convention as
--    member_name_aliases' self-service policies in 20260831180000_add_alias_self_service.sql.
------------------------------------------------------------------------------------------------

-- public.member_activities: members insert their own activity rows (progress logs,
-- commitments) and delete the row for a progress entry they deleted. Everything else
-- (Slack/attendance mirrors, outreach, merges) is admin session or service role.
DROP POLICY IF EXISTS "Authenticated users can modify member_activities" ON public.member_activities;
DROP POLICY IF EXISTS "Insert own activities, admins insert any" ON public.member_activities;
DROP POLICY IF EXISTS "Admins can update member_activities" ON public.member_activities;
DROP POLICY IF EXISTS "Delete own activities, admins delete any" ON public.member_activities;
CREATE POLICY "Insert own activities, admins insert any" ON public.member_activities
  FOR INSERT TO authenticated
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Admins can update member_activities" ON public.member_activities
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Delete own activities, admins delete any" ON public.member_activities
  FOR DELETE TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

-- public.prickle_host_vibes: a host upserts the vibe for a type they host (the server action
-- also checks they host it). Upsert = INSERT ... ON CONFLICT DO UPDATE, so both are needed.
DROP POLICY IF EXISTS "Authenticated users can modify prickle_host_vibes" ON public.prickle_host_vibes;
DROP POLICY IF EXISTS "Hosts insert own vibes, admins insert any" ON public.prickle_host_vibes;
DROP POLICY IF EXISTS "Hosts update own vibes, admins update any" ON public.prickle_host_vibes;
DROP POLICY IF EXISTS "Admins can delete prickle_host_vibes" ON public.prickle_host_vibes;
CREATE POLICY "Hosts insert own vibes, admins insert any" ON public.prickle_host_vibes
  FOR INSERT TO authenticated
  WITH CHECK (host_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Hosts update own vibes, admins update any" ON public.prickle_host_vibes
  FOR UPDATE TO authenticated
  USING (host_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (host_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Admins can delete prickle_host_vibes" ON public.prickle_host_vibes
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- public.wheel_of_wonder_matches: the spinner records their own match; status updates come from
-- the Slack webhook (service role).
DROP POLICY IF EXISTS "Authenticated users can insert wheel_of_wonder_matches" ON public.wheel_of_wonder_matches;
DROP POLICY IF EXISTS "Spinners insert own matches, admins insert any" ON public.wheel_of_wonder_matches;
CREATE POLICY "Spinners insert own matches, admins insert any" ON public.wheel_of_wonder_matches
  FOR INSERT TO authenticated
  WITH CHECK (spinner_member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

-- public.members: members may update only their own row, and (enforced by the trigger below)
-- only the self-service columns. INSERT/DELETE are admin-only (the pipeline and admin user
-- management use the service role or an admin session).
DROP POLICY IF EXISTS "Authenticated users can modify members" ON public.members;
DROP POLICY IF EXISTS "Admins can insert members" ON public.members;
DROP POLICY IF EXISTS "Update own member row, admins update any" ON public.members;
DROP POLICY IF EXISTS "Admins can delete members" ON public.members;
CREATE POLICY "Admins can insert members" ON public.members
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Update own member row, admins update any" ON public.members
  FOR UPDATE TO authenticated
  USING (id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));
CREATE POLICY "Admins can delete members" ON public.members
  FOR DELETE TO authenticated
  USING ((SELECT public.is_admin()));

-- RLS is row-level, so without this a member could also rewrite their own status, email,
-- staff_role, kajabi_id, user_id, etc. Non-admin `authenticated` sessions may change only the
-- columns the settings page edits (identityActions.ts: name + self_service_name_changed_at,
-- birthday_month/day). Admins, service role and postgres (pipeline) are unaffected.
CREATE OR REPLACE FUNCTION public.guard_member_self_service_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  self_service_cols CONSTANT text[] := ARRAY[
    'name', 'self_service_name_changed_at', 'birthday_month', 'birthday_day', 'updated_at'
  ];
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_admin() THEN
    IF (to_jsonb(NEW) - self_service_cols) IS DISTINCT FROM (to_jsonb(OLD) - self_service_cols) THEN
      RAISE EXCEPTION 'members: only % can be changed by the member themselves', self_service_cols
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.guard_member_self_service_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS guard_member_self_service_update ON public.members;
CREATE TRIGGER guard_member_self_service_update
  BEFORE UPDATE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.guard_member_self_service_update();

------------------------------------------------------------------------------------------------
-- 3. Reads of clearly sensitive admin-only data. Only admin pages/routes read these.
------------------------------------------------------------------------------------------------

-- Outreach CRM: prospect names/contact details and staff notes about them.
DROP POLICY IF EXISTS "Allow authenticated users to read outreach_leads" ON public.outreach_leads;
DROP POLICY IF EXISTS "Admins can read outreach_leads" ON public.outreach_leads;
CREATE POLICY "Admins can read outreach_leads" ON public.outreach_leads
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

DROP POLICY IF EXISTS "Allow authenticated users to read outreach_touches" ON public.outreach_touches;
DROP POLICY IF EXISTS "Admins can read outreach_touches" ON public.outreach_touches;
CREATE POLICY "Admins can read outreach_touches" ON public.outreach_touches
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

-- Named "Admins can read ..." but was USING (true); only the admin merge-fix page reads it.
DROP POLICY IF EXISTS "Admins can read dismissed groups" ON public.dismissed_duplicate_groups;
CREATE POLICY "Admins can read dismissed groups" ON public.dismissed_duplicate_groups
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
