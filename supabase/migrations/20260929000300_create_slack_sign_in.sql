-- Sign in to Hedgie Hub from Slack (Local layer, server-only). See lib/slack-sign-in.ts.
--
-- slack_identities: which Hub account a Slack user id may sign in as. Keyed on Slack's immutable
-- user id (U...), never on a handle, display name or member-managed alias. Rows are written only
-- by the server, and only from proof on both sides: today that's a Slack-signed request whose
-- user's (Slack-verified) profile email is the Hub account's sign-in email or the member's
-- canonical email ('email_match'), or one of the member's active email aliases ('email_alias');
-- after that the binding holds even if either email changes. linked_via leaves room for an
-- explicit link flow and admin-made links later.
--
-- slack_sign_in_tokens: the one-time credentials the Home tab and /hub hand out. Each row carries
-- a 256-bit URL token (the "Open Hedgie Hub" button) and a short code for typing into the sign-in
-- page of a browser that isn't the one Slack opens links in (e.g. Safari, when Slack on iOS uses
-- its in-app browser). Only SHA-256 hashes are stored. Spending either one spends the row: a
-- single UPDATE ... WHERE used_at IS NULL AND expires_at > now(). Tokens name the Slack user, not
-- a Hub account; the account is re-resolved from slack_identities when the token is spent.
--
-- RLS is on with no policies and anon/authenticated have no grants: only the service role
-- touches these tables.

CREATE TABLE IF NOT EXISTS public.slack_identities (
  slack_user_id TEXT PRIMARY KEY,
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_via TEXT NOT NULL CHECK (linked_via IN ('email_match', 'email_alias', 'account_link', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.slack_identities IS
  'Local layer: Slack user id -> Hub auth user allowed to sign in from Slack. Server-written only.';

CREATE TABLE IF NOT EXISTS public.slack_sign_in_tokens (
  token_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  slack_user_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slack_sign_in_tokens_slack_user_id_idx ON public.slack_sign_in_tokens (slack_user_id);

COMMENT ON TABLE public.slack_sign_in_tokens IS
  'Local layer: single-use, short-lived Slack sign-in button tokens and codes (hashed). Service role only.';

ALTER TABLE public.slack_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.slack_sign_in_tokens ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.slack_identities FROM anon, authenticated;
REVOKE ALL ON public.slack_sign_in_tokens FROM anon, authenticated;
