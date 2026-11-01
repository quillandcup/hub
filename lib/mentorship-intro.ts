import { createRepos } from "@/lib/data/repos";
import type { SupabaseClient } from "@supabase/supabase-js";
import { APP_URL } from "@/lib/config";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { createNotifier } from "@/lib/notifications/notify";
import type { OutboundMessage } from "@/lib/channels";
import { isMentorshipActive } from "@/lib/mentorship";
import { membersWithFeature } from "@/lib/features.server";

/** What the new member hears about their big sister. */
export function bigSisterMessageForNewMember(mentorName: string, ref?: string): OutboundMessage {
  return {
    title: "Meet your new Big Sister in the Hedgie House!",
    text: `Meet your Big Sister, ${mentorName}! They'll show you around for your first month.`,
    url: `${APP_URL}/big-sisters`,
    ref,
  };
}

/** What the big sister hears about the member they're looking after. */
export function bigSisterMessageForMentor(mentorName: string, newMemberName: string, ref?: string): OutboundMessage {
  return {
    title: `You're a Big Sister, ${mentorName}! You have a new member to welcome 💖`,
    text: `${newMemberName} just joined, and you're their Big Sister. Say hello and invite them to a prickle.`,
    url: `${APP_URL}/big-sisters`,
    ref,
  };
}

/**
 * Introduces a new match to both people: the new member hears who their big sister is, and the
 * big sister who they're looking after (kind `big_sister_match`, so each member's channel choices
 * apply). A match whose 30 days are already up is a record, not news, so it sends nothing. Never
 * throws: the match is saved either way.
 *
 * `service` is a service-role client (the channel adapters read other members' contact details).
 */
export async function sendMatchIntroductions(
  service: SupabaseClient,
  match: { mentorMemberId: string; newMemberId: string; startedOn: string },
  today: string
): Promise<void> {
  try {
    if (!isMentorshipActive(match.startedOn, today)) return;

    const rows = await createRepos(service).members.byIds([match.mentorMemberId, match.newMemberId]);
    const names = new Map(rows.map((m) => [m.id, getMemberDisplayName({ name: m.name, display_name: m.displayName })]));
    const mentorName = names.get(match.mentorMemberId);
    const newMemberName = names.get(match.newMemberId);
    if (!mentorName || !newMemberName) return;

    // Only members who have the big_sisters preview hear about it: the page the message points to
    // is behind it.
    const people = [match.newMemberId, match.mentorMemberId];
    const enabled = await membersWithFeature(createRepos(service), "big_sisters", people);
    const recipients = people.filter((id) => enabled.has(id));
    if (recipients.length === 0) return;

    const notifier = await createNotifier(service, "big_sister_match", recipients);
    const ref = `big-sister:${match.newMemberId}`;
    await Promise.all([
      enabled.has(match.newMemberId) &&
        notifier.canReach(match.newMemberId) &&
        notifier.send(match.newMemberId, bigSisterMessageForNewMember(mentorName, ref)),
      enabled.has(match.mentorMemberId) &&
        notifier.canReach(match.mentorMemberId) &&
        notifier.send(match.mentorMemberId, bigSisterMessageForMentor(mentorName, newMemberName, ref)),
    ]);
  } catch (error) {
    console.error("[big-sisters] Sending introductions failed", error);
  }
}
