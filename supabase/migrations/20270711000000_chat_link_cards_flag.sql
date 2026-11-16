-- The `chat_link_cards` feature: links to Hub pages in chat messages (a message, a prickle, a member) are drawn as cards, decided for each
-- reader. Off for everyone until it is switched on for a segment or globally. Only the flag row: the cards read what the pages already read.
INSERT INTO feature_flags (feature_key, enabled_globally)
VALUES ('chat_link_cards', false)
ON CONFLICT (feature_key) DO NOTHING;
