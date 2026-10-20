-- Members can choose their own display name, from their own name aliases (or clear it to fall
-- back to their real name). Adds display_name to the columns the self-service guard allows and
-- checks the value is one of the member's aliases, since the settings action is not the only
-- way to reach the table. Admins, service role and postgres are unaffected.
CREATE OR REPLACE FUNCTION public.guard_member_self_service_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  self_service_cols CONSTANT text[] := ARRAY[
    'name', 'self_service_name_changed_at', 'birthday_month', 'birthday_day', 'display_name', 'updated_at'
  ];
BEGIN
  IF current_user = 'authenticated' AND NOT public.is_admin() THEN
    IF (to_jsonb(NEW) - self_service_cols) IS DISTINCT FROM (to_jsonb(OLD) - self_service_cols) THEN
      RAISE EXCEPTION 'members: only % can be changed by the member themselves', self_service_cols
        USING ERRCODE = '42501';
    END IF;
    IF NEW.display_name IS DISTINCT FROM OLD.display_name AND NEW.display_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.member_name_aliases a
         WHERE a.member_id = NEW.id AND a.alias = NEW.display_name AND a.active
       ) THEN
      RAISE EXCEPTION 'members: display_name must be one of your active names'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
