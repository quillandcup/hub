-- Per-host "vibe" tagging for the Prickle Picker. The same prickle_type can
-- feel very different depending on who hosts it (e.g. Midnight Crew w/ one
-- host is goofier/social; the same type w/ another host is heads-down), so
-- this is keyed by (type, host) rather than living on prickle_types.
--
-- Self-service: a hostess tags her own recurring slots from her profile page.
-- Authorization is enforced in the server action (scoped to the acting
-- member's own host_id via getEffectiveIdentity), not in RLS -- consistent
-- with how every other table in this project is protected (see
-- 20260720034138_enable_rls_on_exposed_tables.sql).

CREATE TABLE prickle_host_vibes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_id UUID NOT NULL REFERENCES prickle_types(id) ON DELETE CASCADE,
  host_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  vibe TEXT NOT NULL DEFAULT 'balanced' CHECK (vibe IN ('focused', 'balanced', 'chatty')),
  notes TEXT,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (type_id, host_id)
);

CREATE INDEX idx_prickle_host_vibes_type_host ON prickle_host_vibes(type_id, host_id);

COMMENT ON TABLE prickle_host_vibes IS
  'Self-tagged vibe (focused/balanced/chatty) + notes for a given (prickle type, host) recurring series. Used by the Prickle Picker to rank candidates by mood.';

ALTER TABLE prickle_host_vibes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view prickle_host_vibes"
  ON prickle_host_vibes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can modify prickle_host_vibes"
  ON prickle_host_vibes FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
