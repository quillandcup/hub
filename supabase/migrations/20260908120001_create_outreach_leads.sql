-- LOCAL layer: outreach status for Kajabi leads tagged "Ideal Hedgie".
-- One row per member, tracking where Ania is in manually working a lead:
--   cold   - not yet reached out
--   warm   - reached out, no CTA yet
--   hot    - has a call to action to schedule a trial prickle
-- Not reprocessed by /api/process/members — this is operational data the
-- app owns, same as member_hiatus_history.
CREATE TABLE outreach_leads (
  member_id UUID PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'cold' CHECK (status IN ('hot', 'warm', 'cold')),
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER update_outreach_leads_updated_at
  BEFORE UPDATE ON outreach_leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE outreach_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read outreach_leads"
  ON outreach_leads FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert outreach_leads"
  ON outreach_leads FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Allow authenticated users to update outreach_leads"
  ON outreach_leads FOR UPDATE TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to delete outreach_leads"
  ON outreach_leads FOR DELETE TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON outreach_leads TO authenticated;
GRANT ALL ON outreach_leads TO service_role;

COMMENT ON TABLE outreach_leads IS 'LOCAL: Manual outreach status (hot/warm/cold) for Kajabi leads tagged "Ideal Hedgie", set from /admin/outreach. Not reprocessed.';
