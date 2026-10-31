-- People found on Instagram who might be ideal Hedgies, before they are leads (docs/PROSPECTING.md).
-- LOCAL layer: the app owns this table, nothing reprocesses it. A prospect is found, scored by the
-- rules in lib/prospecting/rules.ts, reviewed by a person, and worked from /admin/outreach once they
-- sign up. Whether one joined is derived by matching the handle to members.instagram_url, never stored.
CREATE TABLE public.outreach_prospects (
  id text PRIMARY KEY DEFAULT public.new_id('prsp'),
  -- Lowercase, no "@": one row per account.
  instagram_handle text NOT NULL UNIQUE CHECK (instagram_handle ~ '^[a-z0-9._]{1,30}$'),
  -- Where we found them: 'paste' today; a discovery source's name later.
  source text NOT NULL DEFAULT 'paste',
  source_note text,
  bio text,
  follower_count integer CHECK (follower_count >= 0),
  hashtags text[] NOT NULL DEFAULT '{}',
  external_url text,
  -- The rules' verdict (lib/prospecting/score.ts), kept with the reasons so a reviewer sees why.
  fit_score integer NOT NULL DEFAULT 0 CHECK (fit_score BETWEEN 0 AND 100),
  fit_reasons text[] NOT NULL DEFAULT '{}',
  scored_at timestamptz NOT NULL DEFAULT now(),
  -- An AI read of the profile (summary, fit, a suggested opener); null until one is made. Advice only.
  ai_assessment jsonb,
  ai_assessed_at timestamptz,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'shortlisted', 'rejected', 'contacted')),
  reject_reason text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX outreach_prospects_status_score ON public.outreach_prospects (status, fit_score DESC);

CREATE TRIGGER update_outreach_prospects_updated_at
  BEFORE UPDATE ON public.outreach_prospects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TABLE public.outreach_prospects IS 'LOCAL: Instagram accounts that might be ideal Hedgies, with a rules-based fit score and a review status. Admin only. Not reprocessed. [id prefix: prsp_]';

ALTER TABLE public.outreach_prospects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read outreach_prospects" ON public.outreach_prospects FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins insert outreach_prospects" ON public.outreach_prospects FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins update outreach_prospects" ON public.outreach_prospects FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));

GRANT SELECT, INSERT, UPDATE ON public.outreach_prospects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outreach_prospects TO service_role;
