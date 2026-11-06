-- "On hold" is merged into "Hibernating": the app no longer offers or maps to on_hold. This moves the
-- projects that have it. The check keeps accepting on_hold for now (expand, then contract): the code
-- still running during a deploy can write it, and dropping it from the check is the next change, once
-- this one has deployed.

set lock_timeout = '5s';

UPDATE public.writing_projects SET phase = 'hibernating' WHERE phase = 'on_hold';
