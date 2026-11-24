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
vi.mock("@/lib/admin-auth", () => ({
  requireActionPermission: vi.fn(async () => ({ ok: true, user: { id: "user-admin", email: "admin@example.test" }, supabase: {}, role: "admin", roles: ["admin"], realRole: "admin", realRoles: ["admin"] })),
}));

const TABLE: [() => Promise<Record<string, unknown>>, string, [string, string][]][] = [
  [() => import("@/app/(member)/prickles/checkin-actions"), "src/app/(member)/prickles/checkin-actions.ts", [["saveCheckin", "checkin_saved"], ["saveCheckinHalf", "checkin_half_saved"]]],
  [() => import("@/app/(member)/my-prickles/commitment-actions"), "src/app/(member)/my-prickles/commitment-actions.ts", [["createCommitment", "commitment_created"], ["cancelCommitment", "commitment_cancelled"]]],
  [() => import("@/app/(member)/my-prickles/calendar-feed-actions"), "src/app/(member)/my-prickles/calendar-feed-actions.ts", [["addPrickleToMyCalendar", "calendar_item_added"], ["addEventToMyCalendar", "calendar_item_added"], ["regenerateMyCalendarFeedToken", "calendar_feed_regenerated"], ["removeMyCalendarItem", "calendar_item_removed"]]],
  [() => import("@/app/(member)/prickle-picker/actions"), "src/app/(member)/prickle-picker/actions.ts", [["saveHostVibe", "host_vibe_saved"]]],
  [() => import("@/app/(member)/hosting/actions"), "src/app/(member)/hosting/actions.ts", [["requestToHost", "host_requested"], ["updateMySchedule", "hosting_schedule_updated"], ["withdrawMySchedule", "hosting_schedule_withdrawn"]]],
  [() => import("@/app/(member)/projects/actions"), "src/app/(member)/projects/actions.ts", [["createProject", "project_created"], ["publishProject", "project_published"], ["deleteProject", "project_deleted"], ["logProgress", "progress_logged"], ["createGoal", "goal_created"], ["dismissUnloggedPrickle", "unlogged_prickle_dismissed"], ["updateProjectDetails", "project_details_saved"], ["updateProjectCover", "project_cover_changed"], ["setStartingBalances", "starting_balances_saved"], ["setProjectVisibility", "project_visibility_changed"], ["reorderMyProjects", "projects_reordered"], ["reorderMyGoals", "goals_reordered"], ["updateProjectPhase", "project_phase_changed"], ["updateEntry", "progress_entry_edited"], ["deleteEntry", "progress_entry_deleted"], ["updateGoal", "goal_edited"], ["deleteGoal", "goal_deleted"], ["archiveGoal", "goal_archived"], ["toggleGoalStar", "goal_star_toggled"], ["setGoalVisibility", "goal_visibility_changed"]]],
  [() => import("@/app/(member)/bookshelf/actions"), "src/app/(member)/bookshelf/actions.ts", [["addBook", "book_added"], ["updateBook", "book_edited"], ["deleteBook", "book_deleted"]]],
  [() => import("@/app/(member)/awards/actions"), "src/app/(member)/awards/actions.ts", [["addAward", "award_added"], ["updateAward", "award_edited"], ["deleteAward", "award_deleted"]]],
  [() => import("@/app/(member)/courses/actions"), "src/app/(member)/courses/actions.ts", [["setLessonComplete", "lesson_completion_saved"], ["clearMyLessonProgress", "lesson_progress_cleared"]]],
  [() => import("@/app/(member)/courses/comment-actions"), "src/app/(member)/courses/comment-actions.ts", [["postLessonComment", "lesson_comment_posted"], ["editLessonComment", "lesson_comment_edited"], ["deleteLessonComment", "lesson_comment_deleted"], ["reportLessonComment", "lesson_comment_reported"], ["setLessonCommentFollow", "lesson_follow_toggled"]]],
  [() => import("@/app/(admin)/admin/courses/comment-moderation-actions"), "src/app/(admin)/admin/courses/comment-moderation-actions.ts", [["hideLessonComment", "lesson_comment_hidden"], ["unhideLessonComment", "lesson_comment_unhidden"], ["deleteLessonCommentAsStaff", "lesson_comment_deleted_by_staff"], ["approveHeldLessonComment", "lesson_comment_approved"], ["markLessonCommentHandled", "lesson_comment_handled"], ["dismissLessonCommentReports", "lesson_comment_reports_dismissed"]]],
  [() => import("@/app/(member)/chat/actions"),"src/app/(member)/chat/actions.ts", [["sendChatMessage", "chat_message_sent"], ["toggleChatReaction", "chat_reaction_toggled"], ["retryChatMessage", "chat_message_retried"], ["markChatUnread", "chat_message_marked_unread"]]],
  [() => import("@/app/(member)/chat/notify-actions"), "src/app/(member)/chat/notify-actions.ts", [["setChatNotifySetting", "chat_notify_setting_set"]]],
  [() => import("@/app/(member)/chat/dm-controls-actions"), "src/app/(member)/chat/dm-controls-actions.ts", [["pressChatDmControl", "chat_dm_control_pressed"]]],
  [() => import("@/app/(member)/chat/dm-actions"), "src/app/(member)/chat/dm-actions.ts", [["startDirectMessage", "chat_dm_started"]]],
  [() => import("@/app/(member)/chat/membership-actions"), "src/app/(member)/chat/membership-actions.ts", [["addChatMembers", "chat_members_added"], ["joinChatChannel", "chat_channel_joined"], ["removeChatMember", "chat_member_removed"]]],
  [() => import("@/app/(member)/big-sisters/actions"), "src/app/(member)/big-sisters/actions.ts", [["setBigSisterAvailability", "big_sister_availability_set"], ["saveReasonNote", "big_sister_note_saved"]]],
  [() => import("@/app/(member)/members/[id]/noteActions"), "src/app/(member)/members/[id]/noteActions.ts", [["saveMemberNote", "member_note_saved"]]],
  [() => import("@/app/(member)/settings/notificationActions"), "src/app/(member)/settings/notificationActions.ts", [["setNotificationChannel", "notification_setting_changed"], ["setChatMainPlace", "chat_main_place_set"], ["savePushSubscription", "push_enabled"], ["removePushSubscription", "push_disabled"], ["pausePushSubscription", "push_paused"], ["resumePushSubscription", "push_resumed"], ["removePushDevice", "push_device_removed"]]],
  [() => import("@/app/(member)/settings/actions"), "src/app/(member)/settings/actions.ts", [["updateTimezonePreference", "timezone_changed"], ["updateSecondaryTimezone", "secondary_timezone_changed"], ["revokeSession", "session_revoked"], ["signOutOtherSessions", "session_revoked"]]],
  [() => import("@/app/(member)/settings/profileActions"), "src/app/(member)/settings/profileActions.ts", [["setRosterVisibility", "profile_saved"], ["updateProfileDetails", "profile_saved"], ["updateAskMeAbout", "ask_me_about_saved"], ["updateInstagramHandle", "instagram_handle_saved"]]],
  [() => import("@/app/(member)/settings/identityActions"), "src/app/(member)/settings/identityActions.ts", [["updateRealName", "real_name_changed"], ["setDisplayName", "display_name_changed"], ["setCustomDisplayName", "display_name_changed"], ["updateBirthday", "birthday_saved"], ["addNameAlias", "name_alias_added"], ["addEmailAlias", "email_alias_added"], ["resendEmailVerification", "email_verification_sent"], ["makeEmailPrimary", "email_made_primary"], ["sendReauthCode", "reauth_code_sent"], ["verifyReauthCode", "reauth_code_verified"], ["setNameAliasPublic", "name_alias_public_set"]]],
  [() => import("@/app/(member)/settings/writerProfileActions"), "src/app/(member)/settings/writerProfileActions.ts", [["claimWriterHandle", "writer_profile_handle_set"], ["setWriterProfileSwitch", "writer_profile_switched"], ["saveWriterProfileDetails", "writer_profile_settings_saved"], ["addProfilePenName", "writer_profile_pen_name_added"]]],
  [() => import("@/app/(member)/settings/profileVisibilityActions"), "src/app/(member)/settings/profileVisibilityActions.ts", [["setProfileVisibility", "profile_visibility_set"]]],
  [() => import("@/app/(member)/settings/slackConnectActions"), "src/app/(member)/settings/slackConnectActions.ts", [["disconnectSlackAction", "slack_disconnected"]]],
  [() => import("@/app/actions/onboarding"), "src/app/actions/onboarding.ts", [["startOnboarding", "onboarding_started"], ["dismissOnboarding", "onboarding_dismissed"], ["completeOnboarding", "onboarding_completed"], ["markOnboardingStep", "onboarding_step_marked"]]],
  [() => import("@/app/(admin)/admin/outreach/prospects/actions"), "src/app/(admin)/admin/outreach/prospects/actions.ts", [["importProspects", "prospects_imported"], ["searchForProspects", "prospects_searched"], ["reviewProspect", "prospect_reviewed"]]],
  [() => import("@/app/(admin)/admin/courses/actions"), "src/app/(admin)/admin/courses/actions.ts", [["createCourse", "course_created"], ["updateCourseDetails", "course_details_saved"], ["setCoursePublished", "course_publish_changed"]]],
  [
    () => import("@/app/(admin)/admin/courses/outline-actions"),
    "src/app/(admin)/admin/courses/outline-actions.ts",
    [["addCourseModule", "course_module_added"], ["addCourseLesson", "course_lesson_added"], ["renameCourseItem", "course_item_renamed"], ["deleteCourseItem", "course_item_deleted"], ["duplicateCourseItem", "course_item_duplicated"], ["reorderCourseItems", "course_items_reordered"], ["setCourseItemStatus", "course_item_status_set"], ["saveLessonText", "course_lesson_text_saved"], ["setLessonThumbnail", "course_lesson_thumbnail_set"], ["moveCourseLesson", "course_lesson_moved"]],
  ],
  [
    () => import("@/app/(admin)/admin/courses/lesson-caption-actions"),
    "src/app/(admin)/admin/courses/lesson-caption-actions.ts",
    [["addLessonCaptions", "course_lesson_captions_added"], ["generateLessonCaptions", "course_lesson_captions_generated"], ["removeLessonCaptions", "course_lesson_captions_removed"]],
  ],
  [
    () => import("@/app/(admin)/admin/courses/lesson-video-actions"),
    "src/app/(admin)/admin/courses/lesson-video-actions.ts",
    [["startLessonVideoUpload", "course_lesson_video_upload_started"], ["refreshLessonVideo", "course_lesson_video_refreshed"], ["setLessonThumbnailFromVideo", "course_lesson_thumbnail_from_frame"], ["removeLessonVideo", "course_lesson_video_removed"]],
  ],
  [() => import("@/app/(admin)/admin/members/[id]/removal-actions"), "src/app/(admin)/admin/members/[id]/removal-actions.ts", [["removeMember", "member_removed"]]],
  [() => import("@/app/(admin)/admin/members/[id]/notes-actions"), "src/app/(admin)/admin/members/[id]/notes-actions.ts", [["addMemberNote", "admin_note_added"], ["editMemberNote", "admin_note_edited"], ["deleteMemberNote", "admin_note_deleted"]]],
  [
    () => import("@/app/(admin)/admin/courses/lesson-file-actions"),
    "src/app/(admin)/admin/courses/lesson-file-actions.ts",
    [["startLessonFileUpload", "course_lesson_file_upload_started"], ["finishLessonFileUpload", "course_lesson_file_added"], ["removeLessonFile", "course_lesson_file_removed"]],
  ],
  [
    () => import("@/app/(admin)/admin/care/actions"),
    "src/app/(admin)/admin/care/actions.ts",
    [["startEngagement", "care_engagement_started"], ["logCareMessage", "care_message_logged"], ["updateEngagement", "care_engagement_updated"], ["closeEngagement", "care_engagement_closed"], ["renewEngagement", "care_engagement_renewed"], ["deleteEngagement", "care_engagement_deleted"], ["proposeCareHandover", "care_handover_proposed"], ["acceptCareHandover", "care_handover_accepted"], ["declineCareHandover", "care_handover_declined"], ["cancelCareHandover", "care_handover_cancelled"], ["claimCarePlan", "care_plan_claimed"], ["takeOverCarePlan", "care_plan_taken_over"], ["dismissCareTakeoverNotice", "care_takeover_notice_dismissed"]],
  ],
  [() => import("@/app/(admin)/admin/courses/take-over-actions"), "src/app/(admin)/admin/courses/take-over-actions.ts", [["takeOverCourse", "course_taken_over"]]],
  [
    () => import("@/app/(admin)/admin/courses/quiz-actions"),
    "src/app/(admin)/admin/courses/quiz-actions.ts",
    [["addQuizLesson", "course_quiz_added"], ["saveQuizQuestion", "course_quiz_question_saved"], ["deleteQuizQuestion", "course_quiz_question_deleted"], ["reorderQuizQuestions", "course_quiz_questions_reordered"], ["saveQuizSettings", "course_quiz_settings_saved"], ["removeQuiz", "course_quiz_removed"]],
  ],
  [() => import("@/app/(admin)/admin/courses/duplicate-actions"), "src/app/(admin)/admin/courses/duplicate-actions.ts", [["duplicateCourse", "course_duplicated"]]],
  [() => import("@/app/(admin)/admin/courses/delete-actions"), "src/app/(admin)/admin/courses/delete-actions.ts", [["deleteCourse", "course_deleted"]]],
  [
    () => import("@/app/(admin)/admin/pages/actions"),
    "src/app/(admin)/admin/pages/actions.ts",
    [["createLandingPage", "landing_page_created"], ["createLandingPageWithAi", "landing_page_ai_built"], ["generateLandingBlocks", "landing_page_ai_added"], ["reviseLandingBlocks", "landing_page_ai_revised"], ["updateLandingPageDetails", "landing_page_details_saved"], ["publishLandingPage", "landing_page_published"], ["unpublishLandingPage", "landing_page_unpublished"], ["restoreLandingPageVersion", "landing_page_version_restored"], ["resetLandingDraftToPublished", "landing_page_draft_reset"], ["importLandingDraftJson", "landing_page_json_imported"], ["createLandingPageFromJson", "landing_page_created_from_file"], ["duplicateLandingPage", "landing_page_duplicated"], ["deleteLandingPage", "landing_page_deleted"]],
  ],
  [() => import("@/app/(admin)/admin/pages/design/actions"), "src/app/(admin)/admin/pages/design/actions.ts", [["publishSiteTemplate", "landing_site_published"], ["resetSiteDraft", "landing_site_draft_reset"], ["restoreSiteVersion", "landing_site_version_restored"]]],
  [
    () => import("@/app/(admin)/admin/pages/template-actions"),
    "src/app/(admin)/admin/pages/template-actions.ts",
    [["saveLandingTemplate", "landing_template_saved"], ["replaceLandingDraftWithTemplate", "landing_template_applied"]],
  ],
  [() => import("@/app/api/admin/landing-pages/import/route"), "src/app/api/admin/landing-pages/import/route.ts", [["POST", "landing_page_imported"]]],
  [() => import("@/app/api/feedback/route"), "src/app/api/feedback/route.ts", [["POST", "feedback_submitted"]]],
  [() => import("@/app/api/feature-previews/route"), "src/app/api/feature-previews/route.ts", [["POST", "feature_preview_changed"]]],
  [() => import("@/app/api/projects/import/trackbear/route"), "src/app/api/projects/import/trackbear/route.ts", [["POST", "trackbear_imported"]]],
  [() => import("@/app/api/bookshelf/cover/route"), "src/app/api/bookshelf/cover/route.ts", [["POST", "book_cover_uploaded"]]],
  [() => import("@/app/api/profile/photo/route"), "src/app/api/profile/photo/route.ts", [["POST", "profile_photo_uploaded"], ["DELETE", "profile_photo_removed"]]],
  [() => import("@/app/api/milestone-photos/route"), "src/app/api/milestone-photos/route.ts", [["POST", "milestone_photo_set"], ["DELETE", "milestone_photo_removed"]]],
  [() => import("@/app/api/bookshelf/cover/[assetId]/route"), "src/app/api/bookshelf/cover/[assetId]/route.ts", [["PATCH", "book_cover_edited"]]],
  [() => import("@/app/api/media/route"), "src/app/api/media/route.ts", [["POST", "media_asset_uploaded"]]],
  [() => import("@/app/api/media/[id]/route"), "src/app/api/media/[id]/route.ts", [["PATCH", "media_asset_edited"], ["DELETE", "media_asset_deleted"]]],
  [() => import("@/app/api/media/from-event-photo/route"), "src/app/api/media/from-event-photo/route.ts", [["POST", "media_asset_copied_from_event"]]],
  [() => import("@/app/(admin)/admin/hygiene/zoom-meetings/actions"), "src/app/(admin)/admin/hygiene/zoom-meetings/actions.ts", [["decideZoomMeetings", "zoom_meetings_decided"]]],
  [() => import("@/app/(member)/settings/milestoneActions"), "src/app/(member)/settings/milestoneActions.ts", [["answerMilestone", "milestone_answered"], ["addMilestone", "milestone_added"], ["takeBackMilestone", "milestone_taken_back"], ["setMilestonePhotoAlt", "milestone_photo_alt_set"]]],
  [() => import("@/app/(member)/projects/stageMilestoneActions"), "src/app/(member)/projects/stageMilestoneActions.ts", [["answerStageMilestone", "milestone_stage_answered"]]],
  [() => import("@/app/(member)/wheel-of-wonder/actions"), "src/app/(member)/wheel-of-wonder/actions.ts", [["spinWheel", "wheel_spun"], ["introduceOnSlack", "wheel_introduced"]]],
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
