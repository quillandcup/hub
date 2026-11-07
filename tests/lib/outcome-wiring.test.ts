import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OUTCOME_ACTIONS } from "@/lib/analytics/actions";

/**
 * Every server action in the outcome list is wired to `withAction` with the right name. The wrapper
 * is called with `withAction` replaced by a stand-in that returns the action's name instead of running
 * it, so this tests the wiring (which action id each exported action reports) without needing each
 * action's own dependencies. What `withAction` does is tested in analytics-server.test.ts.
 */
vi.mock("@/lib/analytics/server", () => ({
  withAction: vi.fn(async (action: string) => `ran:${action}`),
  actionOutcome: vi.fn(),
}));

// The admin actions check the caller before they report; here the caller is always an admin.
vi.mock("@/lib/admin-auth", () => ({ requireAdminAction: vi.fn(async () => ({ ok: true, user: { id: "user-admin", email: "admin@example.test" }, supabase: {} })) }));

const TABLE: [() => Promise<Record<string, unknown>>, string, [string, string][]][] = [
  [() => import("@/app/(member)/prickles/checkin-actions"), "app/(member)/prickles/checkin-actions.ts", [["saveCheckin", "checkin_saved"], ["saveCheckinHalf", "checkin_half_saved"]]],
  [() => import("@/app/(member)/my-prickles/commitment-actions"), "app/(member)/my-prickles/commitment-actions.ts", [["createCommitment", "commitment_created"], ["cancelCommitment", "commitment_cancelled"]]],
  [() => import("@/app/(member)/my-prickles/calendar-feed-actions"), "app/(member)/my-prickles/calendar-feed-actions.ts", [["addPrickleToMyCalendar", "calendar_item_added"], ["addEventToMyCalendar", "calendar_item_added"], ["regenerateMyCalendarFeedToken", "calendar_feed_regenerated"], ["removeMyCalendarItem", "calendar_item_removed"]]],
  [() => import("@/app/(member)/prickle-picker/actions"), "app/(member)/prickle-picker/actions.ts", [["saveHostVibe", "host_vibe_saved"]]],
  [() => import("@/app/(member)/hosting/actions"), "app/(member)/hosting/actions.ts", [["requestToHost", "host_requested"], ["updateMySchedule", "hosting_schedule_updated"], ["withdrawMySchedule", "hosting_schedule_withdrawn"]]],
  [() => import("@/app/(member)/projects/actions"), "app/(member)/projects/actions.ts", [["createProject", "project_created"], ["publishProject", "project_published"], ["deleteProject", "project_deleted"], ["logProgress", "progress_logged"], ["createGoal", "goal_created"], ["dismissUnloggedPrickle", "unlogged_prickle_dismissed"], ["updateProjectDetails", "project_details_saved"], ["updateProjectCover", "project_cover_changed"], ["setStartingBalances", "starting_balances_saved"], ["toggleProjectVisibility", "project_visibility_changed"], ["updateProjectPhase", "project_phase_changed"], ["updateEntry", "progress_entry_edited"], ["deleteEntry", "progress_entry_deleted"], ["updateGoal", "goal_edited"], ["deleteGoal", "goal_deleted"], ["archiveGoal", "goal_archived"], ["toggleGoalStar", "goal_star_toggled"], ["toggleGoalVisibility", "goal_visibility_changed"]]],
  [() => import("@/app/(member)/bookshelf/actions"), "app/(member)/bookshelf/actions.ts", [["addBook", "book_added"], ["updateBook", "book_edited"], ["deleteBook", "book_deleted"]]],
  [() => import("@/app/(member)/awards/actions"), "app/(member)/awards/actions.ts", [["addAward", "award_added"], ["updateAward", "award_edited"], ["deleteAward", "award_deleted"]]],
  [() => import("@/app/(member)/courses/actions"), "app/(member)/courses/actions.ts", [["setLessonComplete", "lesson_completion_saved"], ["clearMyLessonProgress", "lesson_progress_cleared"]]],
  [() => import("@/app/(member)/chat/actions"), "app/(member)/chat/actions.ts", [["sendChatMessage", "chat_message_sent"], ["toggleChatReaction", "chat_reaction_toggled"], ["retryChatMessage", "chat_message_retried"]]],
  [() => import("@/app/(member)/chat/dm-actions"), "app/(member)/chat/dm-actions.ts", [["startDirectMessage", "chat_dm_started"]]],
  [() => import("@/app/(member)/chat/membership-actions"), "app/(member)/chat/membership-actions.ts", [["addChatMembers", "chat_members_added"], ["joinChatChannel", "chat_channel_joined"], ["removeChatMember", "chat_member_removed"]]],
  [() => import("@/app/(member)/big-sisters/actions"), "app/(member)/big-sisters/actions.ts", [["setBigSisterAvailability", "big_sister_availability_set"], ["saveReasonNote", "big_sister_note_saved"]]],
  [() => import("@/app/(member)/members/[id]/noteActions"), "app/(member)/members/[id]/noteActions.ts", [["saveMemberNote", "member_note_saved"]]],
  [() => import("@/app/(member)/settings/notificationActions"), "app/(member)/settings/notificationActions.ts", [["setNotificationChannel", "notification_setting_changed"], ["savePushSubscription", "push_enabled"], ["removePushSubscription", "push_disabled"], ["pausePushSubscription", "push_paused"], ["resumePushSubscription", "push_resumed"], ["removePushDevice", "push_device_removed"]]],
  [() => import("@/app/(member)/settings/actions"), "app/(member)/settings/actions.ts", [["updateTimezonePreference", "timezone_changed"], ["updateSecondaryTimezone", "secondary_timezone_changed"], ["revokeSession", "session_revoked"], ["signOutOtherSessions", "session_revoked"]]],
  [() => import("@/app/(member)/settings/profileActions"), "app/(member)/settings/profileActions.ts", [["setRosterVisibility", "profile_saved"], ["updateProfileDetails", "profile_saved"], ["updateAskMeAbout", "ask_me_about_saved"], ["updateInstagramHandle", "instagram_handle_saved"]]],
  [() => import("@/app/(member)/settings/identityActions"), "app/(member)/settings/identityActions.ts", [["updateRealName", "real_name_changed"], ["setDisplayName", "display_name_changed"], ["setCustomDisplayName", "display_name_changed"], ["updateBirthday", "birthday_saved"], ["addNameAlias", "name_alias_added"], ["addEmailAlias", "email_alias_added"], ["resendEmailVerification", "email_verification_sent"], ["makeEmailPrimary", "email_made_primary"], ["sendReauthCode", "reauth_code_sent"], ["verifyReauthCode", "reauth_code_verified"]]],
  [() => import("@/app/(member)/settings/slackConnectActions"), "app/(member)/settings/slackConnectActions.ts", [["disconnectSlackAction", "slack_disconnected"]]],
  [() => import("@/app/actions/onboarding"), "app/actions/onboarding.ts", [["startOnboarding", "onboarding_started"], ["dismissOnboarding", "onboarding_dismissed"], ["completeOnboarding", "onboarding_completed"], ["markOnboardingStep", "onboarding_step_marked"]]],
  [() => import("@/app/(admin)/admin/outreach/prospects/actions"), "app/(admin)/admin/outreach/prospects/actions.ts", [["importProspects", "prospects_imported"], ["searchForProspects", "prospects_searched"], ["reviewProspect", "prospect_reviewed"]]],
  [() => import("@/app/(admin)/admin/courses/actions"), "app/(admin)/admin/courses/actions.ts", [["createCourse", "course_created"], ["updateCourseDetails", "course_details_saved"], ["setCoursePublished", "course_publish_changed"]]],
  [
    () => import("@/app/(admin)/admin/courses/outline-actions"),
    "app/(admin)/admin/courses/outline-actions.ts",
    [["addCourseModule", "course_module_added"], ["addCourseLesson", "course_lesson_added"], ["renameCourseItem", "course_item_renamed"], ["deleteCourseItem", "course_item_deleted"], ["duplicateCourseItem", "course_item_duplicated"], ["reorderCourseItems", "course_items_reordered"], ["setCourseItemStatus", "course_item_status_set"], ["saveLessonText", "course_lesson_text_saved"], ["setLessonThumbnail", "course_lesson_thumbnail_set"], ["moveCourseLesson", "course_lesson_moved"]],
  ],
  [
    () => import("@/app/(admin)/admin/courses/lesson-caption-actions"),
    "app/(admin)/admin/courses/lesson-caption-actions.ts",
    [["addLessonCaptions", "course_lesson_captions_added"], ["generateLessonCaptions", "course_lesson_captions_generated"], ["removeLessonCaptions", "course_lesson_captions_removed"]],
  ],
  [
    () => import("@/app/(admin)/admin/courses/lesson-video-actions"),
    "app/(admin)/admin/courses/lesson-video-actions.ts",
    [["startLessonVideoUpload", "course_lesson_video_upload_started"], ["refreshLessonVideo", "course_lesson_video_refreshed"], ["setLessonThumbnailFromVideo", "course_lesson_thumbnail_from_frame"], ["removeLessonVideo", "course_lesson_video_removed"]],
  ],
  [() => import("@/app/(admin)/admin/members/[id]/removal-actions"), "app/(admin)/admin/members/[id]/removal-actions.ts", [["removeMember", "member_removed"]]],
  [() => import("@/app/(admin)/admin/members/[id]/notes-actions"), "app/(admin)/admin/members/[id]/notes-actions.ts", [["addMemberNote", "admin_note_added"], ["editMemberNote", "admin_note_edited"], ["deleteMemberNote", "admin_note_deleted"]]],
  [
    () => import("@/app/(admin)/admin/courses/lesson-file-actions"),
    "app/(admin)/admin/courses/lesson-file-actions.ts",
    [["startLessonFileUpload", "course_lesson_file_upload_started"], ["finishLessonFileUpload", "course_lesson_file_added"], ["removeLessonFile", "course_lesson_file_removed"]],
  ],
  [() => import("@/app/(admin)/admin/courses/take-over-actions"), "app/(admin)/admin/courses/take-over-actions.ts", [["takeOverCourse", "course_taken_over"]]],
  [() => import("@/app/api/feedback/route"), "app/api/feedback/route.ts", [["POST", "feedback_submitted"]]],
  [() => import("@/app/api/feature-previews/route"), "app/api/feature-previews/route.ts", [["POST", "feature_preview_changed"]]],
  [() => import("@/app/api/projects/import/trackbear/route"), "app/api/projects/import/trackbear/route.ts", [["POST", "trackbear_imported"]]],
  [() => import("@/app/api/bookshelf/cover/route"), "app/api/bookshelf/cover/route.ts", [["POST", "book_cover_uploaded"]]],
  [() => import("@/app/api/bookshelf/cover/[assetId]/route"), "app/api/bookshelf/cover/[assetId]/route.ts", [["PATCH", "book_cover_edited"]]],
  [() => import("@/app/api/media/route"), "app/api/media/route.ts", [["POST", "media_asset_uploaded"]]],
  [() => import("@/app/api/media/[id]/route"), "app/api/media/[id]/route.ts", [["PATCH", "media_asset_edited"], ["DELETE", "media_asset_deleted"]]],
  [() => import("@/app/api/media/from-event-photo/route"), "app/api/media/from-event-photo/route.ts", [["POST", "media_asset_copied_from_event"]]],
  [() => import("@/app/(member)/wheel-of-wonder/actions"), "app/(member)/wheel-of-wonder/actions.ts", [["spinWheel", "wheel_spun"], ["introduceOnSlack", "wheel_introduced"]]],
];

describe.each(TABLE)("%#: wired actions", (load, file, wired) => {
  it.each(wired)("%s reports %s", async (name, action) => {
    const mod = await load();
    expect(typeof mod[name]).toBe("function");
    expect(await (mod[name] as () => Promise<unknown>)()).toBe(`ran:${action}`);
  });
});

describe("the outcome list", () => {
  const root = path.resolve(__dirname, "../..");
  const files = TABLE.map(([, file]) => file);
  const used = files.flatMap((file) =>
    [...fs.readFileSync(path.join(root, file), "utf8").matchAll(/withAction\(\s*"([a-z_]+)"/g)].map((m) => m[1])
  );

  it("is exactly what the wrapped actions report: nothing unused, nothing wired that isn't listed", () => {
    expect(new Set(used)).toEqual(new Set(OUTCOME_ACTIONS));
  });

  it("keeps the unwrapped implementation private, so every call goes through the wrapper", () => {
    for (const file of files) {
      const source = fs.readFileSync(path.join(root, file), "utf8");
      expect(source, file).not.toMatch(/export (async )?function \w+Impl\b/);
      expect(source, file).toMatch(/Usage analytics: each action records whether it worked/);
    }
  });
});
