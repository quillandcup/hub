-- A member's optional secondary time zone, shown beside their own on prickle times (like Google
-- Calendar's additional time zone). NULL = off, the default; members opt in under Settings.
alter table public.user_profiles add column secondary_timezone text;

comment on column public.user_profiles.secondary_timezone is
  'Optional IANA time zone shown beside timezone_preference on prickle times; NULL = off. Set by the member (updateSecondaryTimezone).';
