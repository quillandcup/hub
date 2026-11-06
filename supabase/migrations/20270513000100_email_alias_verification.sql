-- An email alias can be verified: the member opened a link we sent to that address. Only a verified
-- alias can be made the primary email. Matching is unchanged: an alias counts as the member whether or
-- not it is verified (it is how Zoom, Slack and Stripe records under an old address still find them).
--
-- Both columns are written by the server only (service role). A member can insert and update their own
-- alias rows, so a trigger keeps them from setting the columns themselves or carrying a verification over
-- to a different address.
set lock_timeout = '5s';

alter table public.member_email_aliases
  add column if not exists verified_at timestamptz,
  add column if not exists verification_sent_at timestamptz;

comment on column public.member_email_aliases.verified_at is
  'When the member opened the verification link sent to this address; null = not verified. Service role writes only (trigger).';
comment on column public.member_email_aliases.verification_sent_at is
  'When the last verification email went out, so a resend can be rate limited. Service role writes only (trigger).';

create or replace function public.member_email_aliases_guard_verification()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Signed-in members and admins act as `authenticated`; the service role (and migrations) are not guarded.
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.verified_at := null;
      new.verification_sent_at := null;
    elsif new.alias_email is distinct from old.alias_email then
      new.verified_at := null;
      new.verification_sent_at := null;
    else
      new.verified_at := old.verified_at;
      new.verification_sent_at := old.verification_sent_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists member_email_aliases_guard_verification on public.member_email_aliases;
create trigger member_email_aliases_guard_verification
  before insert or update on public.member_email_aliases
  for each row execute function public.member_email_aliases_guard_verification();
