set lock_timeout = '5s';

-- More than one Zoom account feeds the Hub. The primary account is the community's own and keeps today's
-- behaviour (everything it hosts is kept). A secondary account (for example a staff member's personal one, whose link is
-- sometimes used for a session) is mostly not community business, so its meetings stay out of Silver until an admin keeps them.
-- Bronze keeps everything; the exclusion is applied when Silver is processed, so a changed decision plus a reprocess is
-- fully reproducible. See docs/ZOOM_ACCOUNTS.md.
--
-- Expand only: the new Bronze column is nullable with the primary account as its default, so the code live during the
-- deploy (which does not know the column) keeps writing primary rows.

CREATE TABLE public.zoom_accounts (
    id text PRIMARY KEY DEFAULT public.new_id('zacc'),
    slug text NOT NULL UNIQUE,
    label text NOT NULL,
    -- The Zoom user whose reports are imported (informational: the credentials hold the address the import uses).
    host_email text,
    -- keep: every meeting is kept unless an admin ignores it. exclude: every meeting is left out until an admin keeps it.
    default_policy text NOT NULL DEFAULT 'exclude' CHECK (default_policy IN ('keep', 'exclude')),
    -- Environment variable prefix of the credentials: <prefix>_ACCOUNT_ID, _CLIENT_ID, _CLIENT_SECRET, _USER_EMAIL, _WEBHOOK_SECRET_TOKEN.
    credentials_prefix text NOT NULL UNIQUE CHECK (credentials_prefix ~ '^[A-Z][A-Z0-9_]*$'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.zoom_accounts IS
    'Zoom accounts the Hub imports from, with the default for their meetings (keep or exclude) and where their credentials live [id prefix: zacc_]';

-- The primary account has a fixed id: the Bronze columns default to it.
INSERT INTO public.zoom_accounts (id, slug, label, default_policy, credentials_prefix)
VALUES ('zacc_Primary1Acct', 'primary', 'Primary account', 'keep', 'ZOOM');

ALTER TABLE public.zoom_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read zoom_accounts" ON public.zoom_accounts
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert zoom_accounts" ON public.zoom_accounts
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update zoom_accounts" ON public.zoom_accounts
    FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
GRANT SELECT, INSERT, UPDATE ON public.zoom_accounts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoom_accounts TO service_role;

-- An admin's decision about meetings of an account. scope 'instance' is keyed by the meeting's uuid (one occurrence),
-- 'series' by Zoom's meeting id (every past and future occurrence of a link). An instance decision beats a series
-- decision, which beats the account's default.
CREATE TABLE public.zoom_meeting_decisions (
    id text PRIMARY KEY DEFAULT public.new_id('zmdc'),
    zoom_account text NOT NULL REFERENCES public.zoom_accounts(id) ON DELETE CASCADE,
    scope text NOT NULL CHECK (scope IN ('instance', 'series')),
    zoom_key text NOT NULL,
    decision text NOT NULL CHECK (decision IN ('kept', 'ignored')),
    decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    decided_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (zoom_account, scope, zoom_key)
);

COMMENT ON TABLE public.zoom_meeting_decisions IS
    'An admin keeps or ignores one Zoom meeting (instance, by uuid) or every occurrence of a link (series, by meeting id); no row means the account default [id prefix: zmdc_]';

ALTER TABLE public.zoom_meeting_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read zoom_meeting_decisions" ON public.zoom_meeting_decisions
    FOR SELECT TO authenticated USING ((SELECT public.is_admin()));
CREATE POLICY "Admins can insert zoom_meeting_decisions" ON public.zoom_meeting_decisions
    FOR INSERT TO authenticated WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can update zoom_meeting_decisions" ON public.zoom_meeting_decisions
    FOR UPDATE TO authenticated USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()));
CREATE POLICY "Admins can delete zoom_meeting_decisions" ON public.zoom_meeting_decisions
    FOR DELETE TO authenticated USING ((SELECT public.is_admin()));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoom_meeting_decisions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.zoom_meeting_decisions TO service_role;

CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.zoom_meeting_decisions
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('zoom_meeting_decision', 'id');
CREATE TRIGGER audit_row_change AFTER INSERT OR UPDATE OR DELETE ON public.zoom_accounts
    FOR EACH ROW EXECUTE FUNCTION public.audit_row_change('zoom_account', 'id');

-- Which account each Bronze row came from. Existing rows and any write by code that does not know the column are the primary account.
ALTER TABLE bronze.zoom_meetings ADD COLUMN zoom_account text NOT NULL DEFAULT 'zacc_Primary1Acct' REFERENCES public.zoom_accounts(id);
ALTER TABLE bronze.zoom_attendees ADD COLUMN zoom_account text NOT NULL DEFAULT 'zacc_Primary1Acct' REFERENCES public.zoom_accounts(id);
ALTER TABLE bronze.zoom_participant_events ADD COLUMN zoom_account text NOT NULL DEFAULT 'zacc_Primary1Acct' REFERENCES public.zoom_accounts(id);
ALTER TABLE bronze.zoom_chat_messages ADD COLUMN zoom_account text NOT NULL DEFAULT 'zacc_Primary1Acct' REFERENCES public.zoom_accounts(id);

-- zoom_chat_messages has column-level grants: the new column needs its own.
GRANT SELECT (zoom_account) ON bronze.zoom_chat_messages TO authenticated;

CREATE INDEX zoom_meetings_account_idx ON bronze.zoom_meetings (zoom_account, start_time DESC);
CREATE INDEX zoom_meetings_meeting_id_idx ON bronze.zoom_meetings (meeting_id);

NOTIFY pgrst, 'reload schema';
