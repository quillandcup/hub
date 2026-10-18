-- The Zoom room link and passcode members are shown for prickles (after check-in, in check-in DMs,
-- in the calendar feed). Managed by admins in the Hub instead of env vars, because the passcode
-- changes monthly. Append-only history: a prickle uses the latest row whose effective_from is at or
-- before its start, so a change applies to prickles moving forward and past ones keep what they had.
-- An admin can schedule a change for a future day (effective_from is that day's start in the org
-- timezone, so a prickle belongs to the day it starts, midnight-crossing ones included) and take back
-- a scheduled one before it takes effect; rows already in effect are never changed or deleted.
CREATE TABLE prickle_join_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  join_url TEXT NOT NULL CHECK (join_url ~ '^https://'),
  passcode TEXT,
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX prickle_join_settings_effective_idx ON prickle_join_settings (effective_from DESC);

ALTER TABLE prickle_join_settings ENABLE ROW LEVEL SECURITY;

-- Members need to read the current link; only admins change it.
CREATE POLICY "Authenticated users can read prickle join settings"
  ON prickle_join_settings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can add prickle join settings"
  ON prickle_join_settings FOR INSERT TO authenticated WITH CHECK (is_admin());

CREATE POLICY "Admins can remove not-yet-effective prickle join settings"
  ON prickle_join_settings FOR DELETE TO authenticated USING (is_admin() AND effective_from > now());

GRANT SELECT, INSERT, DELETE ON prickle_join_settings TO authenticated;
GRANT ALL ON prickle_join_settings TO service_role;
