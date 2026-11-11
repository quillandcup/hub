set lock_timeout = '5s';

-- BRONZE: Zoom in-meeting chat messages, as the meeting.chat_message_sent webhook delivers them.
--
-- A spike: Zoom's only pull path for chat is the CHAT file of a cloud recording, and only a handful of
-- prickles a year are recorded, so the webhook is the real source (see docs/TODO.md, "Zoom in-meeting chat").
-- This table collects it to find out how much chat there is and how many authors match a member before
-- anything is built on it.
--
-- Append-only. Zoom retries deliveries, so UNIQUE (meeting_uuid, message_id) makes a redelivery a no-op.
-- Privacy follows the Slack content tables: the text, who a private message went to and the raw payload are
-- service role only; admins read the other columns, normally through bronze.zoom_chat_messages_meta.
-- A column added later needs its own GRANT SELECT (col) ... TO authenticated.
CREATE TABLE IF NOT EXISTS bronze.zoom_chat_messages (
  id TEXT PRIMARY KEY DEFAULT public.new_id('zmmsg'),
  meeting_uuid TEXT NOT NULL,
  meeting_id TEXT,
  breakout_room_uuid TEXT,
  message_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL,
  sender_name TEXT,
  sender_email TEXT,
  sender_session_id TEXT,
  sender_type TEXT,
  sender_context TEXT,
  -- everyone | host | guest | group | host_group. Only 'everyone' is said to the whole room.
  recipient_type TEXT,
  recipient_context TEXT,
  recipient_session_id TEXT,
  -- Who a private message went to: content, like the text.
  recipient_name TEXT,
  recipient_email TEXT,
  message_text TEXT NOT NULL DEFAULT '',
  has_files BOOLEAN NOT NULL DEFAULT false,
  raw_payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (meeting_uuid, message_id)
);

CREATE INDEX IF NOT EXISTS zoom_chat_messages_sent_at_idx ON bronze.zoom_chat_messages (sent_at);

COMMENT ON TABLE bronze.zoom_chat_messages IS
  'BRONZE: Zoom in-meeting chat messages from the meeting.chat_message_sent webhook [id prefix: zmmsg_]. message_text, recipient_name, recipient_email and raw_payload are service role only; admins can read the other columns, normally through bronze.zoom_chat_messages_meta.';

ALTER TABLE bronze.zoom_chat_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON bronze.zoom_chat_messages FROM anon, authenticated;
GRANT ALL ON bronze.zoom_chat_messages TO service_role;
GRANT SELECT (
  id, meeting_uuid, meeting_id, breakout_room_uuid, message_id, sent_at,
  sender_name, sender_email, sender_session_id, sender_type, sender_context,
  recipient_type, recipient_context, recipient_session_id, has_files, received_at
) ON bronze.zoom_chat_messages TO authenticated;

DROP POLICY IF EXISTS "Admins can read zoom_chat_messages" ON bronze.zoom_chat_messages;
CREATE POLICY "Admins can read zoom_chat_messages" ON bronze.zoom_chat_messages
  FOR SELECT TO authenticated USING ((SELECT public.is_admin()));

CREATE OR REPLACE VIEW bronze.zoom_chat_messages_meta WITH (security_invoker = true) AS
  SELECT
    m.id,
    m.meeting_uuid,
    m.meeting_id,
    m.breakout_room_uuid,
    m.message_id,
    m.sent_at,
    m.sender_name,
    m.sender_email,
    m.sender_type,
    m.recipient_type,
    m.has_files,
    m.received_at
  FROM bronze.zoom_chat_messages m;

COMMENT ON VIEW bronze.zoom_chat_messages_meta IS
  'Zoom chat messages without their content (who, when, to whom in kind, not what). Runs as the caller: admins only, by the policy on bronze.zoom_chat_messages.';

REVOKE ALL ON bronze.zoom_chat_messages_meta FROM anon, authenticated;
GRANT SELECT ON bronze.zoom_chat_messages_meta TO authenticated, service_role;

-- Which prickle types' chat is said in the open. A standard writing prickle's chat is treated like a private
-- channel (the default); a special event or educational webinar's like a public one. Fail-closed: a type is
-- private until someone says otherwise. Nothing reads this yet: a follow-up maps a meeting to its prickle's
-- type before chat text reaches member activity or an admin screen.

ALTER TABLE prickle_types
  ADD COLUMN IF NOT EXISTS chat_visibility TEXT NOT NULL DEFAULT 'private'
  CONSTRAINT prickle_types_chat_visibility_check CHECK (chat_visibility IN ('public', 'private'));

COMMENT ON COLUMN prickle_types.chat_visibility IS
  'How the in-meeting Zoom chat of this type is treated: public (a special event or educational webinar, like a public channel) or private (a standard prickle, like a private channel; the default). Admin-editable.';

-- Best-guess seed by type name, like purpose: the educational webinars, the parties and the virtual retreat.
UPDATE prickle_types SET chat_visibility = 'public'
  WHERE normalized_name IN ('educational', 'qc-holiday-party', 'qc-birthday-party', 'virtual-retreat');
