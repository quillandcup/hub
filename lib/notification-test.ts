import { CHANNEL_ADAPTERS, CHANNELS, type ChannelId, type OutboundMessage } from "@/lib/channels";
import { createRepos } from "@/lib/data/repos";
import { bigSisterMessageForMentor, bigSisterMessageForNewMember } from "@/lib/mentorship-intro";
import { loadIntroChannelId } from "@/lib/newcomer-signals";
import { introNudgeMessage, prickleNudgeMessage } from "@/lib/member-reminders";
import { checkinMessage, checkoutMessage } from "@/lib/prickle-checkin-dms";
import { NOTIFICATION_SETTINGS_PATH } from "@/lib/notifications/notify";
import { joinAt, loadPrickleJoinSettings } from "@/lib/prickle-join";
import { APP_URL } from "@/lib/config";
import type { NotificationKindId } from "@/lib/notifications/registry";

/**
 * Admin "send me a test": every notification kind, on every channel, to the admin's own member
 * record. It skips preferences and feature flags' opt-ins (the admin asked for it just now) but
 * not what a channel needs to reach someone (a Slack match, an email address, a subscribed device,
 * the in-app feature flag), and it says why when it can't. Outside production Slack and email are
 * redirected to the dev address (SLACK_TEST_MODE / EMAIL_TEST_MODE), as for any send.
 *
 * The messages are the real ones, built by the same functions the features use, with sample data
 * where they'd need a member or prickle, and marked "[Test]".
 */

/** Why a channel couldn't reach the admin, for when its address lookup comes back empty. */
export const UNREACHABLE_REASON: Record<ChannelId, string> = {
  slack: "No Slack account is matched to your member record.",
  in_app: "The In-app notifications preview isn't on for you (Settings → Previews).",
  web_push: "No device of yours has Browser notifications turned on (Settings → Notifications), or the Browser notifications preview is off.",
  email: "Your member record has no email address.",
};

const TEST_PREFIX = "[Test] ";

/** The prickle a check-in or check-out sample is about: the next one, else the latest, else a stand-in. */
async function samplePrickle(supabase: any, now: Date) {
  const prickle = await createRepos(supabase).prickles.nextOrMostRecent(now.toISOString());
  if (prickle?.type?.name) return { id: prickle.id, typeName: prickle.type.name, startTime: prickle.startTime, endTime: prickle.endTime };
  return { id: "sample", typeName: "Sprint Prickle", startTime: now.toISOString(), endTime: new Date(now.getTime() + 60 * 60 * 1000).toISOString() };
}

const marked = (message: OutboundMessage): OutboundMessage => ({
  ...message,
  text: TEST_PREFIX + message.text,
  title: message.title ? TEST_PREFIX + message.title : undefined,
});

/**
 * The sample messages for one kind: usually one, two when it goes to two different people (Big Sisters).
 * Marked as tests by default (the admin test send); `{ test: false }` gives them as a member receives them,
 * which is what the notification mockups in demo/ draw.
 */
export async function sampleMessages(
  supabase: any,
  kind: NotificationKindId,
  now = new Date(),
  { test = true }: { test?: boolean } = {},
): Promise<OutboundMessage[]> {
  const mark = (message: OutboundMessage) => (test ? marked(message) : message);
  switch (kind) {
    case "prickle_checkin":
      return [
        checkinMessage(await samplePrickle(supabase, now), null, {
          test,
          join: joinAt(await loadPrickleJoinSettings(createRepos(supabase)), now),
        }),
      ];
    case "prickle_checkout":
      return [checkoutMessage(await samplePrickle(supabase, now), null, [], { test })];
    case "intro_nudge":
      return [mark(introNudgeMessage(await loadIntroChannelId(createRepos(supabase))))];
    case "prickle_nudge":
      return [mark(prickleNudgeMessage("first"))];
    case "big_sister_match":
      return [mark(bigSisterMessageForNewMember("Marlow", "sample")), mark(bigSisterMessageForMentor("Marlow", "Linden", "sample"))];
  }
}

export type TestSendResult = { ok: true; sent: number } | { ok: false; error: string };

/**
 * Sends the kind's sample message(s) to `memberId` on `channel`. Uses the channel adapter directly
 * (not the notifier) so a failure comes back with its reason instead of only being logged.
 */
export async function sendTestNotification(
  supabase: any,
  memberId: string,
  kind: NotificationKindId,
  channel: ChannelId,
  now = new Date()
): Promise<TestSendResult> {
  const adapter = CHANNEL_ADAPTERS[channel];
  const address = (await adapter.resolveAddresses(supabase, [memberId])).get(memberId);
  if (!address) return { ok: false, error: UNREACHABLE_REASON[channel] };

  const messages = await sampleMessages(supabase, kind, now);
  try {
    for (const message of messages) {
      await adapter.send(
        address,
        { ...message, footerLinks: [{ label: "Notification settings", url: `${APP_URL}${NOTIFICATION_SETTINGS_PATH}` }] },
        { kind, memberId }
      );
    }
  } catch (error) {
    const label = CHANNELS.find((c) => c.id === channel)!.label;
    return { ok: false, error: `${label} failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  return { ok: true, sent: messages.length };
}
