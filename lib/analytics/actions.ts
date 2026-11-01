/**
 * The server actions whose outcome is recorded (`action_completed`: which action, and whether it
 * worked). A click on "Save" says someone tried; this says whether it saved. Each id is one
 * action, named for what it does (`project_created`), and wired up at the bottom of the action's
 * file with `withAction` (lib/analytics/server.ts). Add one here, then wrap the action.
 */
export const OUTCOME_ACTIONS = [
  // Prickles and check-ins
  "checkin_saved",
  "checkin_half_saved",
  "commitment_created",
  "commitment_cancelled",
  "calendar_item_added",
  "calendar_feed_regenerated",
  "host_vibe_saved",
  "unlogged_prickle_dismissed",
  // Hosting
  "host_requested",
  "hosting_schedule_updated",
  "hosting_schedule_withdrawn",
  // Writing
  "project_created",
  "project_published",
  "project_deleted",
  "progress_logged",
  "goal_created",
  "book_added",
  "award_added",
  // Courses
  "lesson_completion_saved",
  "course_created",
  "course_details_saved",
  "course_publish_changed",
  "course_module_added",
  "course_lesson_added",
  "course_item_renamed",
  "course_item_deleted",
  "course_item_duplicated",
  "course_items_reordered",
  "course_item_status_set",
  // Chat
  "chat_message_sent",
  "chat_reaction_toggled",
  "chat_message_edited",
  "chat_message_deleted",
  "chat_members_added",
  "chat_member_removed",
  "chat_channel_joined",
  "chat_file_deleted",
  // Community
  "wheel_spun",
  "wheel_introduced",
  "big_sister_availability_set",
  "member_note_saved",
  // Settings
  "notification_setting_changed",
  "push_enabled",
  "push_disabled",
  "nav_mode_changed",
  "timezone_changed",
  "secondary_timezone_changed",
  "session_revoked",
  "profile_saved",
  "ask_me_about_saved",
  "display_name_changed",
  "real_name_changed",
  "birthday_saved",
  "name_alias_added",
  "email_alias_added",
  "slack_disconnected",
  // Outreach
  "prospects_imported",
  "prospects_searched",
  "prospect_reviewed",
  // Onboarding
  "onboarding_started",
  "onboarding_dismissed",
  "onboarding_completed",
  "onboarding_step_marked",
] as const;

export type OutcomeAction = (typeof OUTCOME_ACTIONS)[number];
