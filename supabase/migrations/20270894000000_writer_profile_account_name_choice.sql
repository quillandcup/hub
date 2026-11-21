set lock_timeout = '5s';

-- The name a writer profile shows (docs/product/WRITER_PROFILES.md, "The name"): the display name, one of the member's public pen
-- names (`public_name_alias_id`), or the name on their account. The account name is the legal name for many members, so it
-- is shown only when the member picked it on purpose: this is that pick. Expand only: one new column, false for every
-- profile that exists, so nothing shown changes.
ALTER TABLE public.writer_profiles ADD COLUMN use_account_name boolean NOT NULL DEFAULT false;

-- One choice at a time: a pen name or the account name, never both.
ALTER TABLE public.writer_profiles
  ADD CONSTRAINT writer_profiles_one_name_choice CHECK (NOT (use_account_name AND public_name_alias_id IS NOT NULL)) NOT VALID;
ALTER TABLE public.writer_profiles VALIDATE CONSTRAINT writer_profiles_one_name_choice;

-- A member changes their own profile's name choice, like the other settings (the handle and the rest are not theirs to write).
GRANT UPDATE (use_account_name) ON public.writer_profiles TO authenticated;

COMMENT ON COLUMN public.writer_profiles.use_account_name IS
  'The member chose the name on their account as the name their profile shows. False means the display name, or the pen name in public_name_alias_id.';
