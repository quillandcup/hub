-- Fix "new row violates row-level security policy for table writing_projects" for members whose
-- login email differs from their member email.
--
-- The app resolves the acting member with getEffectiveIdentity (lib/sudo.ts): members.user_id =
-- the auth user first, members.email = the JWT email only as a fallback. The owner policies below
-- were written when members.user_id wasn't populated, so they matched by email alone
-- (`member_id IN (SELECT id FROM members WHERE email = auth.email())`). Since
-- 20260909000003_backfill_members_user_id.sql a member can be linked by user_id while the two
-- emails differ (they changed their email in Kajabi, or signed up to the Hub with another
-- address). The app then picks the right member, and RLS rejects every write for it.
--
-- Move these policies to current_member_id(), the convention every newer table already uses
-- (20260926000600_tighten_permissive_write_policies.sql). Admins still bypass via is_admin(),
-- which is also what makes sudo writes work.

------------------------------------------------------------------------------------------------
-- 1. current_member_id(): prefer the user_id link over the email fallback, like
--    getEffectiveIdentity. It was `user_id = ... OR email = ... LIMIT 1` with no ORDER BY, so
--    when one member row matched by user_id and a different one by email (a split Kajabi
--    contact), which row came back was arbitrary and could disagree with the app.
------------------------------------------------------------------------------------------------
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
  ORDER BY (user_id IS NOT DISTINCT FROM (SELECT auth.uid())) DESC, id
  LIMIT 1;
$$;

------------------------------------------------------------------------------------------------
-- 2. Member-owned writing / bookshelf tables.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members manage their own writing_projects" ON public.writing_projects;
CREATE POLICY "Members manage their own writing_projects"
  ON public.writing_projects FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members manage their own writing_progress_entries" ON public.writing_progress_entries;
CREATE POLICY "Members manage their own writing_progress_entries"
  ON public.writing_progress_entries FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members manage their own writing_goals" ON public.writing_goals;
CREATE POLICY "Members manage their own writing_goals"
  ON public.writing_goals FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members manage their own writing_project_starting_balances" ON public.writing_project_starting_balances;
CREATE POLICY "Members manage their own writing_project_starting_balances"
  ON public.writing_project_starting_balances FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members manage their own member_books" ON public.member_books;
CREATE POLICY "Members manage their own member_books"
  ON public.member_books FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

DROP POLICY IF EXISTS "Members manage their own member_awards" ON public.member_awards;
CREATE POLICY "Members manage their own member_awards"
  ON public.member_awards FOR ALL TO authenticated
  USING (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()))
  WITH CHECK (member_id = (SELECT public.current_member_id()) OR (SELECT public.is_admin()));

------------------------------------------------------------------------------------------------
-- 3. prickle_schedules: a host writes their own rows in an unlocked month.
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Hosts manage their own unlocked prickle_schedules" ON public.prickle_schedules;
CREATE POLICY "Hosts manage their own unlocked prickle_schedules"
  ON public.prickle_schedules FOR ALL TO authenticated
  USING (
    (host_id = (SELECT public.current_member_id()) AND NOT public.is_prickle_schedule_month_locked(month))
    OR (SELECT public.is_admin())
  )
  WITH CHECK (
    (host_id = (SELECT public.current_member_id()) AND NOT public.is_prickle_schedule_month_locked(month))
    OR (SELECT public.is_admin())
  );

------------------------------------------------------------------------------------------------
-- 4. book-covers storage: writes scoped to the member's own folder (<member id>/...).
------------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Members can upload their own book covers" ON storage.objects;
CREATE POLICY "Members can upload their own book covers"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] = (SELECT public.current_member_id())::text
            OR (SELECT public.is_admin())
        )
    );

DROP POLICY IF EXISTS "Members can replace or remove their own book covers" ON storage.objects;
CREATE POLICY "Members can replace or remove their own book covers"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] = (SELECT public.current_member_id())::text
            OR (SELECT public.is_admin())
        )
    );

DROP POLICY IF EXISTS "Members can delete their own book covers" ON storage.objects;
CREATE POLICY "Members can delete their own book covers"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'book-covers'
        AND (
            (storage.foldername(name))[1] = (SELECT public.current_member_id())::text
            OR (SELECT public.is_admin())
        )
    );
