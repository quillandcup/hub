-- Pin the search_path of the one function in public that still had none.
--
-- member_activities_stamp_sudo() is the BEFORE INSERT trigger that stamps who a staff member was acting as onto
-- member_activities rows. It is not SECURITY DEFINER (it runs with the rights of whoever inserts) and a trigger function
-- cannot be called as a plain function, so this is hardening, not a hole: the Supabase security advisor
-- (function_search_path_mutable) was the only finding left besides the definer-function warnings reviewed in
-- docs/trust/SECURITY_DEFINER_REVIEW.md. The body names current_acting_as_member_id() without a schema, so it is pinned to
-- public, where that function lives.
--
-- Expand-only: no behavior change for any caller. The pgTAP test security_definer_review.test.sql now fails for any
-- function in public without a pinned search_path (a later CREATE OR REPLACE without the SET clause drops it).
set lock_timeout = '5s';

ALTER FUNCTION public.member_activities_stamp_sudo() SET search_path = public;
