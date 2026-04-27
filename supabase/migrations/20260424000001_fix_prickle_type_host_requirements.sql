-- Fix requires_host settings for prickle types based on actual usage patterns
--
-- Based on data quality analysis:
-- - Some types are community-driven and don't need hosts
-- - Some types require facilitation and should have hosts

-- Types that DON'T require hosts (community events, self-directed)
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'heads-down';
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'open-table';
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'craft-chat';
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'midnight-crew';
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'feel-good-friday';
UPDATE prickle_types SET requires_host = false WHERE normalized_name = 'pop-up';

-- Types that DO require hosts (facilitated sessions)
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'progress';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'plot-or-plan';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'sprint';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'pitch';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'social-media-sunday';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'pomodoro';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'authorlife-heads-down';
UPDATE prickle_types SET requires_host = true WHERE normalized_name = 'monthly-goal-review';
