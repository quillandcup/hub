-- Seed prickle types for Quill & Cup
-- These are the core prickle types used in the community

INSERT INTO prickle_types (name, normalized_name, description, requires_host, default_host_id)
VALUES
  ('Progress Prickle', 'progress', 'General progress prickles', true, NULL),
  ('Plot or Plan Prickle', 'plot-or-plan', 'Plot or plan sessions', true, NULL),
  ('Sprint Prickle', 'sprint', 'Focused sprint sessions', true, NULL),
  ('Heads Down Prickle', 'heads-down', 'Deep work sessions', true, NULL),
  ('Pitch Prickle', 'pitch', 'Pitching and feedback sessions', true, NULL),
  ('Midnight Crew', 'midnight-crew', 'Late night writing crew', false, NULL),
  ('Feel Good Friday Prickle', 'feel-good-friday', 'Friday celebration prickles', false, NULL),
  ('Open Table', 'open-table', 'Open community hangouts', false, NULL),
  ('Social Media Sunday', 'social-media-sunday', 'Social media planning', false, NULL),
  ('Craft & Chat', 'craft-chat', 'Crafting and conversation', false, NULL),
  ('Pomodoro', 'pomodoro', 'Pomodoro technique sessions', false, NULL),
  ('AuthorLife Heads Down', 'authorlife-heads-down', 'Author life deep work', false, NULL),
  ('Monthly Goal Review', 'monthly-goal-review', 'Monthly goal planning', false, NULL),
  ('Pop-Up Prickle', 'pop-up', 'Spontaneous prickles from Zoom', false, NULL)
ON CONFLICT (normalized_name) DO NOTHING;
