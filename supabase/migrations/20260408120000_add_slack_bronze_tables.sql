-- Bronze Layer: Raw Slack Data

-- Raw Slack messages from all accessible channels, DMs, and threads
CREATE TABLE IF NOT EXISTS slack_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Slack identifiers (natural key for deduplication)
    message_ts TEXT NOT NULL, -- Slack's message timestamp (unique per channel)
    channel_id TEXT NOT NULL,

    -- Message metadata
    channel_name TEXT,
    channel_type TEXT, -- 'public_channel', 'private_channel', 'im' (DM), 'mpim' (group DM)
    user_id TEXT NOT NULL, -- Slack user ID
    user_email TEXT, -- May be null for bot users or privacy settings
    user_name TEXT,

    -- Content
    text TEXT, -- Message text (empty for file-only messages)
    message_type TEXT, -- 'message', 'file_share', 'thread_broadcast'

    -- Threading
    thread_ts TEXT, -- Parent message timestamp if this is a reply
    reply_count INTEGER DEFAULT 0, -- For parent messages
    reply_users_count INTEGER DEFAULT 0,

    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL, -- When message was posted
    edited_at TIMESTAMP WITH TIME ZONE, -- If message was edited
    deleted_at TIMESTAMP WITH TIME ZONE, -- Soft delete for deleted messages

    -- Files (if message has attachments)
    files JSONB, -- Array of file metadata

    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL -- Full Slack API response
);

-- Unique constraint (prevents duplicate imports, supports UPSERT)
CREATE UNIQUE INDEX idx_slack_messages_unique ON slack_messages(channel_id, message_ts);

-- Query indexes
CREATE INDEX idx_slack_messages_user_id ON slack_messages(user_id);
CREATE INDEX idx_slack_messages_user_email ON slack_messages(user_email);
CREATE INDEX idx_slack_messages_occurred_at ON slack_messages(occurred_at);
CREATE INDEX idx_slack_messages_channel_id ON slack_messages(channel_id);
CREATE INDEX idx_slack_messages_thread_ts ON slack_messages(thread_ts);
CREATE INDEX idx_slack_messages_deleted_at ON slack_messages(deleted_at) WHERE deleted_at IS NOT NULL;

COMMENT ON TABLE slack_messages IS 'Bronze: Raw Slack messages from all accessible channels, DMs, and threads';

-- Raw Slack reactions
CREATE TABLE IF NOT EXISTS slack_reactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Natural key for deduplication
    message_ts TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    reaction TEXT NOT NULL, -- Emoji name (e.g., 'thumbsup', 'heart')
    user_id TEXT NOT NULL,

    -- Metadata
    user_email TEXT,
    user_name TEXT,

    -- Timing
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    removed_at TIMESTAMP WITH TIME ZONE, -- If reaction was removed

    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

-- Unique constraint (one user can only react with same emoji once per message)
CREATE UNIQUE INDEX idx_slack_reactions_unique ON slack_reactions(channel_id, message_ts, reaction, user_id);

-- Query indexes
CREATE INDEX idx_slack_reactions_user_id ON slack_reactions(user_id);
CREATE INDEX idx_slack_reactions_message ON slack_reactions(channel_id, message_ts);
CREATE INDEX idx_slack_reactions_occurred_at ON slack_reactions(occurred_at);

COMMENT ON TABLE slack_reactions IS 'Bronze: Raw Slack reactions (emoji reactions on messages)';

-- Slack channels catalog
CREATE TABLE IF NOT EXISTS slack_channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Slack identifier
    channel_id TEXT NOT NULL UNIQUE,

    -- Channel metadata
    name TEXT NOT NULL,
    is_private BOOLEAN DEFAULT false,
    is_archived BOOLEAN DEFAULT false,
    member_count INTEGER,
    topic TEXT,
    purpose TEXT,
    created TIMESTAMP WITH TIME ZONE,

    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

CREATE INDEX idx_slack_channels_name ON slack_channels(name);
CREATE INDEX idx_slack_channels_is_archived ON slack_channels(is_archived);

COMMENT ON TABLE slack_channels IS 'Bronze: Slack channels catalog (public, private, DMs)';

-- Slack users catalog (for matching to members)
CREATE TABLE IF NOT EXISTS slack_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Slack identifier
    user_id TEXT NOT NULL UNIQUE,

    -- User metadata
    email TEXT, -- May be null if user privacy settings hide it
    name TEXT,
    display_name TEXT,
    real_name TEXT,
    is_bot BOOLEAN DEFAULT false,
    is_deleted BOOLEAN DEFAULT false,

    -- Tracking
    imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    raw_payload JSONB NOT NULL
);

CREATE INDEX idx_slack_users_email ON slack_users(email);
CREATE INDEX idx_slack_users_name ON slack_users(real_name);
CREATE INDEX idx_slack_users_is_bot ON slack_users(is_bot);

COMMENT ON TABLE slack_users IS 'Bronze: Slack users catalog (for matching to members)';
