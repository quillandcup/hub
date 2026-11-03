set lock_timeout = '5s';

-- Email events from Resend (docs/EMAIL_TIMELINE.md): sent, delivered, opened, clicked, bounced, complained,
-- failed. Bronze, append-only, one row per event, written by the Resend webhook and by the nightly pull
-- (/api/reconcile/email). The member timeline (member_activities, source 'resend') is derived from it.
--
-- Service role only: it holds recipients' addresses and subjects. Admins read the derived timeline rows,
-- never this table. The body of an email is not copied here; it stays at Resend.

CREATE TABLE bronze.resend_events (
  id          text PRIMARY KEY DEFAULT public.new_id('rsev'),
  -- The webhook's Svix message id, or "pull:<email id>:<event type>" for an event the nightly pull found
  -- from the email's last event. Unique, so a webhook retry or a second import writes nothing new.
  event_id    text NOT NULL UNIQUE,
  -- "email.sent", "email.delivered", "email.opened", "email.clicked", "email.bounced", "email.complained", ...
  event_type  text NOT NULL,
  -- Resend's id of the email; what groups the events of one send.
  email_id    text NOT NULL,
  -- When it happened at Resend (the click's own timestamp for a click).
  occurred_at timestamptz NOT NULL,
  -- Recipients, lower-cased. Our sends have one; a bulk send can have more.
  recipients  text[] NOT NULL DEFAULT '{}',
  from_address text,
  subject     text,
  -- Resend tags set at send time: "kind" (the notification kind) and "member" (the member id).
  tags        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The clicked URL without its query string or fragment (email.clicked): a sign-in link carries a one-time
  -- token there, which is not stored anywhere, the raw payload included.
  link        text,
  -- "Permanent", "Transient" or "Undetermined" (email.bounced).
  bounce_type text,
  -- Why, in words: the bounce or failure message.
  detail      text,
  raw_payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX resend_events_email_idx ON bronze.resend_events (email_id);
CREATE INDEX resend_events_occurred_idx ON bronze.resend_events (occurred_at);

COMMENT ON TABLE bronze.resend_events IS
  'Bronze: email events from Resend (webhook plus nightly pull), append-only. Service role only. Member timeline rows are derived into member_activities (source resend). [id prefix: rsev_]';

ALTER TABLE bronze.resend_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON bronze.resend_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON bronze.resend_events TO service_role;

-- Rebuilding one email's timeline rows (delete by related_id, insert again) without scanning the table.
CREATE INDEX idx_member_activities_resend_related
  ON public.member_activities (related_id)
  WHERE source = 'resend';
