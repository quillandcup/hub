-- An event made from a prickle takes its host from the prickle (the prickle is the single source for title,
-- description, guest speaker and host), so the event's name can say who hosts it: "Progress Prickle" alone
-- isn't enough when there are thirty a week. Free text, the host's display name, kept in step by the
-- calendar sync; null for an event with no prickle or no host.

ALTER TABLE events ADD COLUMN IF NOT EXISTS host_name TEXT;

COMMENT ON COLUMN events.host_name IS 'The display name of the host of the prickle this event stands for, copied from the prickle by the calendar sync. Null when there is no prickle or no host.';
