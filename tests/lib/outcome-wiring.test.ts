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

const TABLE: [() => Promise<Record<string, unknown>>, string, [string, string][]][] = [
  [() => import("@/app/(member)/prickles/checkin-actions"), "app/(member)/prickles/checkin-actions.ts", [["saveCheckin", "checkin_saved"], ["saveCheckinHalf", "checkin_half_saved"]]],
  [() => import("@/app/(member)/my-prickles/commitment-actions"), "app/(member)/my-prickles/commitment-actions.ts", [["createCommitment", "commitment_created"], ["cancelCommitment", "commitment_cancelled"]]],
  [() => import("@/app/(member)/my-prickles/calendar-feed-actions"), "app/(member)/my-prickles/calendar-feed-actions.ts", [["addPrickleToMyCalendar", "calendar_item_added"], ["addEventToMyCalendar", "calendar_item_added"], ["regenerateMyCalendarFeedToken", "calendar_feed_regenerated"]]],
  [() => import("@/app/(member)/prickle-picker/actions"), "app/(member)/prickle-picker/actions.ts", [["saveHostVibe", "host_vibe_saved"]]],
  [() => import("@/app/(member)/hosting/actions"), "app/(member)/hosting/actions.ts", [["requestToHost", "host_requested"], ["updateMySchedule", "hosting_schedule_updated"], ["withdrawMySchedule", "hosting_schedule_withdrawn"]]],
  [() => import("@/app/(member)/projects/actions"), "app/(member)/projects/actions.ts", [["createProject", "project_created"], ["publishProject", "project_published"], ["logProgress", "progress_logged"], ["createGoal", "goal_created"], ["dismissUnloggedPrickle", "unlogged_prickle_dismissed"]]],
  [() => import("@/app/(member)/bookshelf/actions"), "app/(member)/bookshelf/actions.ts", [["addBook", "book_added"]]],
  [() => import("@/app/(member)/awards/actions"), "app/(member)/awards/actions.ts", [["addAward", "award_added"]]],
  [() => import("@/app/(member)/courses/actions"), "app/(member)/courses/actions.ts", [["setLessonComplete", "lesson_completion_saved"]]],
  [() => import("@/app/(member)/chat/actions"), "app/(member)/chat/actions.ts", [["sendChatMessage", "chat_message_sent"], ["toggleChatReaction", "chat_reaction_toggled"]]],
  [() => import("@/app/(member)/big-sisters/actions"), "app/(member)/big-sisters/actions.ts", [["setBigSisterAvailability", "big_sister_availability_set"]]],
  [() => import("@/app/(member)/members/[id]/noteActions"), "app/(member)/members/[id]/noteActions.ts", [["saveMemberNote", "member_note_saved"]]],
  [() => import("@/app/(member)/settings/notificationActions"), "app/(member)/settings/notificationActions.ts", [["setNotificationChannel", "notification_setting_changed"], ["savePushSubscription", "push_enabled"], ["removePushSubscription", "push_disabled"]]],
  [() => import("@/app/(member)/settings/actions"), "app/(member)/settings/actions.ts", [["updateTimezonePreference", "timezone_changed"], ["revokeSession", "session_revoked"], ["signOutOtherSessions", "session_revoked"]]],
  [() => import("@/app/(member)/settings/profileActions"), "app/(member)/settings/profileActions.ts", [["setRosterVisibility", "profile_saved"], ["updateProfileDetails", "profile_saved"], ["updateAskMeAbout", "ask_me_about_saved"]]],
  [() => import("@/app/(member)/settings/identityActions"), "app/(member)/settings/identityActions.ts", [["updateRealName", "real_name_changed"], ["setDisplayName", "display_name_changed"], ["setCustomDisplayName", "display_name_changed"], ["updateBirthday", "birthday_saved"], ["addNameAlias", "name_alias_added"], ["addEmailAlias", "email_alias_added"]]],
  [() => import("@/app/(member)/settings/slackConnectActions"), "app/(member)/settings/slackConnectActions.ts", [["disconnectSlackAction", "slack_disconnected"]]],
  [() => import("@/app/actions/onboarding"), "app/actions/onboarding.ts", [["startOnboarding", "onboarding_started"], ["dismissOnboarding", "onboarding_dismissed"], ["completeOnboarding", "onboarding_completed"], ["markOnboardingStep", "onboarding_step_marked"]]],
  [() => import("@/app/(member)/wheel-of-wonder/actions"), "app/(member)/wheel-of-wonder/actions.ts", [["spinWheel", "wheel_spun"]]],
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
