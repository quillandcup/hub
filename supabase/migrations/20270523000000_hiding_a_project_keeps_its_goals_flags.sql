-- Hiding a project no longer clears its goals' "show on profile" flags: the profile shows a goal only
-- while both the goal and its project are on (get_profile_writing already requires both), so hiding a
-- project and showing it again brings the same goals back. The trigger function stays for now: dropping
-- a function needs its own approval (docs/TODO.md, "Drop writing_project_hides_goals").

set lock_timeout = '5s';

DROP TRIGGER IF EXISTS writing_projects_hide_goals ON public.writing_projects;
