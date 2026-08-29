-- Writing Projects Tracking, Phase 2 (docs/superpowers/specs/writing-projects-tracking.md).

-- Entry tags (item 13). Free-form labels a member attaches to a progress entry
-- (e.g. "editing", "outlining"). No separate tags table -- low cardinality, no
-- cross-entry tag management needed yet, so a plain array column is simplest.
ALTER TABLE writing_progress_entries ADD COLUMN tags TEXT[] NOT NULL DEFAULT '{}';

-- Per-project opt-in to surface on the member's public profile (item 15). Defaults to
-- false -- a project is private until the owning member explicitly shares it.
ALTER TABLE writing_projects ADD COLUMN show_on_profile BOOLEAN NOT NULL DEFAULT false;
