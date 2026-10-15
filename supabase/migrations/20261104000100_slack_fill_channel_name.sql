-- Store the channel name at write time. Slack's message and reaction events carry only the channel
-- id, so rows written by the webhook had no channel_name (only the bulk importer, which walks the
-- conversation list, stamped one). A BEFORE INSERT trigger now fills an empty name from
-- bronze.slack_channels, in the same statement: no extra round trip from the app, and it covers every
-- writer. A name the writer supplies is kept, and a channel we don't know yet (or a direct message,
-- which has no row there) stays empty; the activity rebuild (20261104000000) still resolves those at
-- read time. Group DMs are skipped like everywhere else: they have no channel name.
--
-- Names are a snapshot at insert time, as they already were for imported messages: a later rename
-- changes slack_channels, not rows already written.

CREATE OR REPLACE FUNCTION public.slack_fill_channel_name() RETURNS trigger AS $$
BEGIN
    IF COALESCE(NEW.channel_name, '') = '' THEN
        NEW.channel_name := (
            SELECT c.name FROM bronze.slack_channels c
             WHERE c.channel_id = NEW.channel_id AND NOT COALESCE(c.is_mpim, false) AND COALESCE(c.name, '') <> ''
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER slack_messages_fill_channel_name
    BEFORE INSERT ON bronze.slack_messages
    FOR EACH ROW EXECUTE FUNCTION public.slack_fill_channel_name();
CREATE TRIGGER slack_reactions_fill_channel_name
    BEFORE INSERT ON bronze.slack_reactions
    FOR EACH ROW EXECUTE FUNCTION public.slack_fill_channel_name();

-- Fill in what was already written without a name (the webhook's messages and reactions).
SET LOCAL statement_timeout = 0;
UPDATE bronze.slack_messages m SET channel_name = c.name
  FROM bronze.slack_channels c
 WHERE c.channel_id = m.channel_id AND COALESCE(m.channel_name, '') = ''
   AND NOT COALESCE(c.is_mpim, false) AND COALESCE(c.name, '') <> '';
UPDATE bronze.slack_reactions r SET channel_name = c.name
  FROM bronze.slack_channels c
 WHERE c.channel_id = r.channel_id AND COALESCE(r.channel_name, '') = ''
   AND NOT COALESCE(c.is_mpim, false) AND COALESCE(c.name, '') <> '';
