-- LOCAL layer: log of individual outreach actions (one row per DM/message
-- sent) against Ideal Hedgie leads from /admin/outreach. Unlike
-- outreach_leads (a single mutable hot/warm/cold status per member), this is
-- an insert-only, repeating event log — it's what powers the "N / 25
-- outreaches today" goal on that page and each lead's "last touched" date.
-- Not reprocessed by /api/process/members — this is operational data the
-- app owns, same as outreach_leads and member_hiatus_history.
CREATE TABLE outreach_touches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  touched_by UUID REFERENCES auth.users(id),
  touched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outreach_touches_member_id ON outreach_touches(member_id);
CREATE INDEX idx_outreach_touches_touched_at ON outreach_touches(touched_at);

ALTER TABLE outreach_touches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow authenticated users to read outreach_touches"
  ON outreach_touches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow authenticated users to insert outreach_touches"
  ON outreach_touches FOR INSERT TO authenticated WITH CHECK (true);

GRANT SELECT, INSERT ON outreach_touches TO authenticated;
GRANT ALL ON outreach_touches TO service_role;

COMMENT ON TABLE outreach_touches IS 'LOCAL: Insert-only log of individual outreach actions against Ideal Hedgie leads from /admin/outreach. Powers the daily outreach-goal counter and each lead''s last-touched date. Not reprocessed.';
