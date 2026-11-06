import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every exported server action either records whether it worked (`withAction`, lib/analytics/server.ts) or is on the
 * list below with the reason it doesn't. A new action that is neither fails here, so a feature can't ship with its
 * saves, edits and deletes invisible (the wiring test, outcome-wiring.test.ts, only checks the actions already
 * wired). Reads (get/load/suggest/search/list/find/fetch/preview) are exempt by name.
 */

const root = path.resolve(__dirname, "../..");

/** `file::action` -> why it is not tracked. Keep the reason true: the check below also fails for an entry that no longer applies. */
const NOT_TRACKED: Record<string, string> = {
  // Admin tools: staff, not members; changes to audited tables are in the audit log.
  "app/(admin)/admin/data-health/missing-hosts/actions.ts::setRequiresHost": "admin-only data fix",
  "app/(admin)/admin/data-health/missing-hosts/actions.ts::setDefaultHosts": "admin-only data fix",
  "app/(admin)/admin/data-health/missing-hosts/actions.ts::assignHostToUnhostedPrickles": "admin-only data fix",
  "app/(admin)/admin/data/slack-channels/actions.ts::restrictSlackChannel": "admin-only; recorded in the activity log's Privacy view",
  "app/(admin)/admin/data/slack-channels/actions.ts::unrestrictSlackChannel": "admin-only; recorded in the activity log's Privacy view",
  "app/(admin)/admin/hygiene/merge-fix/actions.ts::dismissGroup": "admin-only housekeeping",
  "app/(admin)/admin/hygiene/merge-fix/actions.ts::undismissGroup": "admin-only housekeeping",
  "app/(admin)/admin/mentorship/actions.ts::createMentorship": "admin-only; audited table",
  "app/(admin)/admin/mentorship/actions.ts::updateMentorship": "admin-only; audited table",
  "app/(admin)/admin/mentorship/actions.ts::deleteMentorship": "admin-only; audited table",
  "app/(admin)/admin/mentorship/actions.ts::addVolunteer": "admin-only; audited table",
  "app/(admin)/admin/mentorship/actions.ts::removeVolunteer": "admin-only; audited table",
  "app/(admin)/admin/notifications/actions.ts::sendDiagnosticPush": "admin-only test send",
  "app/(admin)/admin/notifications/actions.ts::sendTestNotification": "admin-only test send",
  "app/(admin)/admin/prickle-join/actions.ts::savePrickleJoin": "admin-only setting; audited table",
  "app/(admin)/admin/prickle-join/actions.ts::removeScheduledPrickleJoin": "admin-only setting; audited table",
  "app/(admin)/admin/prickles/[id]/actions.ts::sendTestPrickleDM": "admin-only test send",
  "app/(admin)/admin/prickles/[id]/actions.ts::updatePrickle": "admin-only edit; audited table",
  // Noise: fired as a side effect of using the page, not a choice the member made.
  "app/(member)/chat/actions.ts::saveChatDraft": "saves as the member types",
  "app/(member)/chat/actions.ts::markChatRead": "read marker, set on opening a conversation",
  "app/(member)/chat/actions.ts::syncChatReadFromSlack": "background sync of read markers",
  "app/(member)/chat/actions.ts::prepareChatUploads": "prepares upload links; the send itself is chat_message_sent",
  "app/actions/search.ts::markSuggestionsRead": "marks suggestions as seen",
  // Recorded another way.
  "app/actions/in-app-notifications.ts::markInAppNotificationsReadAction": "opening a notification is notification_opened",
  "app/actions/in-app-notifications.ts::markInAppNotificationsUnreadAction": "opening a notification is notification_opened",
  "app/actions/in-app-notifications.ts::markAllInAppNotificationsReadAction": "opening notifications is notification_opened",
  "app/(member)/settings/notificationActions.ts::sendTestPushNotification": "a test send the member asked for; no adoption signal",
  // Staff viewing as a member must leave no usage record at all (app/actions/sudo.ts).
  "app/actions/sudo.ts::startSudo": "viewing as a member records nothing",
  "app/actions/sudo.ts::exitSudo": "viewing as a member records nothing",
  "app/actions/sudo.ts::exitSudoToAdmin": "viewing as a member records nothing",
  "app/actions/staff-preview.ts::startRolePreview": "previewing a staff role is a UI check by an admin, records nothing",
  "app/actions/staff-preview.ts::stopRolePreview": "previewing a staff role is a UI check by an admin, records nothing",
  // No signed-in member to attribute an event to, or recording is the thing being declined.
  "app/auth/slack/actions.ts::completeSlackSignIn": "before sign-in; outcomes go to the server logs (lib/signin-log.ts) and failures are reported as signin_failed once the person gets in",
  "app/auth/slack/actions.ts::signInWithSlackCode": "before sign-in; see completeSlackSignIn",
  "app/login/actions.ts::verifyEmailCode": "before sign-in; see completeSlackSignIn",
  "app/login/actions.ts::resendPendingInvite": "before sign-in; see completeSlackSignIn",
  "app/privacy/actions.ts::setAnalyticsOptOut": "choosing not to be recorded must not be recorded",
  "app/unsubscribe/actions.ts::setEmailFromToken": "a public page opened from an email, with no signed-in member",
  "app/verify-email/actions.ts::confirmEmailFromToken": "a public page opened from an email, with no signed-in member",
};

const READ_ONLY = /^(get|load|suggest|search|list|find|fetch|preview)[A-Z]/;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** Every exported async function in a "use server" file, and whether its own text calls withAction. */
function actions() {
  const found: { file: string; name: string; wired: boolean }[] = [];
  for (const full of walk(path.join(root, "app"))) {
    const source = fs.readFileSync(full, "utf8");
    // The directive is a line of its own near the top, after any header comment.
    if (!source.split("\n").slice(0, 40).some((line) => /^["']use server["'];?$/.test(line.trim()))) continue;
    const file = path.relative(root, full);
    for (const part of source.split(/\n(?=export async function |async function |export const |const |function )/)) {
      const match = /^export async function (\w+)\(/.exec(part);
      if (match) found.push({ file, name: match[1], wired: part.includes("withAction(") });
    }
  }
  return found;
}

describe("server action outcomes", () => {
  const all = actions();

  it("finds the actions (a parse that finds none would pass everything)", () => {
    expect(all.length).toBeGreaterThan(150);
    expect(all.filter((a) => a.wired).length).toBeGreaterThan(90);
  });

  it("records an outcome for every action that isn't a read, unless it is listed with a reason", () => {
    const missing = all.filter((a) => !a.wired && !READ_ONLY.test(a.name) && !(`${a.file}::${a.name}` in NOT_TRACKED)).map((a) => `${a.file}::${a.name}`);
    expect(missing, "wrap these with withAction (and add the name to lib/analytics/actions.ts), or list them in NOT_TRACKED with the reason").toEqual([]);
  });

  it("keeps the list honest: nothing on it is gone, wired or a read", () => {
    const byKey = new Map(all.map((a) => [`${a.file}::${a.name}`, a]));
    const stale = Object.keys(NOT_TRACKED).filter((key) => {
      const action = byKey.get(key);
      return !action || action.wired || READ_ONLY.test(action.name);
    });
    expect(stale).toEqual([]);
  });
});
