/**
 * What Slack DMs say about "who spoke last" in a Hedgie Care engagement (docs/HEDGIE_CARE.md, "Slack DMs fill it in").
 * Pure: no database, no Slack. The reads and writes are in lib/care-dm.ts. Only times appear here, never message text.
 */
import { ORG_TIMEZONE } from "@/lib/config";
import { orgYmd } from "@/lib/org-week";
import { zonedTimeToUtc } from "@/lib/prickle-schedules";
import type { CareTimes } from "@/lib/care";

/**
 * The earliest moment a DM message counts for an engagement: the start of the Eastern calendar day it was opened on. A
 * message she sent just before logging the start of the engagement (earlier the same day) still counts; yesterday's does
 * not. A calendar day, not 24 hours, so a clock-change day (23 or 25 hours) and an evening opening (already tomorrow in UTC)
 * both land on the right midnight.
 */
export function dmCountsFrom(openedAt: string | Date): Date {
  const opened = typeof openedAt === "string" ? new Date(openedAt) : openedAt;
  return zonedTimeToUtc(orgYmd(opened), "00:00", ORG_TIMEZONE);
}

/** When the staff member and the member last wrote in their DM (each null when they never have, or Bronze has nothing). */
export type DmLastWrites = { staffAt: string | null; memberAt: string | null };

/** The times to move forward on an engagement; a key is absent when that side has nothing newer to say. */
export type DerivedMessageTimes = { staffAt?: string; memberAt?: string };

const later = (candidate: string, stored: string | null) => stored === null || Date.parse(candidate) > Date.parse(stored);

/**
 * Of the last-written times of a tracked DM, the ones that move an open engagement forward: a time counts when it is on or
 * after `dmCountsFrom(opened_at)` and later than what is already stored (a manual log or an earlier derivation), so the
 * result never moves a time back, never repeats one (applying it twice changes nothing), and ignores everything from
 * before the engagement. The times are the latest message of each person, so a later message supersedes an earlier one and
 * nothing older matters.
 */
export function derivedMessageTimes(
  engagement: Pick<CareTimes, "opened_at" | "last_staff_message_at" | "last_member_message_at">,
  writes: DmLastWrites
): DerivedMessageTimes {
  const from = dmCountsFrom(engagement.opened_at).getTime();
  const counts = (at: string | null): at is string => at !== null && Date.parse(at) >= from;
  const out: DerivedMessageTimes = {};
  if (counts(writes.staffAt) && later(writes.staffAt, engagement.last_staff_message_at)) out.staffAt = new Date(writes.staffAt).toISOString();
  if (counts(writes.memberAt) && later(writes.memberAt, engagement.last_member_message_at)) out.memberAt = new Date(writes.memberAt).toISOString();
  return out;
}

/** Who wrote last in a DM, and when: null when neither has written. */
export function lastWriter(writes: DmLastWrites): { who: "staff" | "member"; at: string } | null {
  const staff = writes.staffAt ? Date.parse(writes.staffAt) : null;
  const member = writes.memberAt ? Date.parse(writes.memberAt) : null;
  if (staff === null && member === null) return null;
  if (member === null || (staff !== null && staff >= member)) return { who: "staff", at: writes.staffAt as string };
  return { who: "member", at: writes.memberAt as string };
}

/** Who a care plan belongs to: its owner, else whoever opened it (the one the derivation reads the DM of). */
export const careOwnerOf = (engagement: { owned_by: string | null; opened_by: string | null }) => engagement.owned_by ?? engagement.opened_by;

/**
 * Whether an engagement's "who spoke last" is kept up to date from the signed-in staff user's tracked Slack DM: it is on the
 * Slack DM channel, they own it, and they track a DM with that member. The same pairing the derivation (`lib/care-dm.ts`)
 * projects, so the "from Slack" hint and the hidden "They replied" / "I replied" buttons agree with what it fills in. (The
 * caller adds "open": a closed period is no longer derived.)
 */
export function followsTrackedDm(
  engagement: { channel: string; member_id: string; owned_by: string | null; opened_by: string | null },
  tracked: { userId: string; memberIds: ReadonlySet<string> }
): boolean {
  return engagement.channel === "slack_dm" && careOwnerOf(engagement) === tracked.userId && tracked.memberIds.has(engagement.member_id);
}

/**
 * The members for whom a Slack DM care plan she starts now would follow her tracked DM. A new period takes the owner of
 * the member's latest one (newest start first, as `CareRepository.forMember` orders them), else the person starting it, so
 * a tracked DM only counts when that owner is her.
 */
export function membersWhoseNewCareFollowsDm(
  userId: string,
  trackedMemberIds: ReadonlySet<string>,
  engagements: readonly { member_id: string; owned_by: string | null; opened_at: string; id: string }[]
): Set<string> {
  const follows = new Set<string>();
  for (const memberId of trackedMemberIds) {
    const latest = engagements
      .filter((e) => e.member_id === memberId)
      .sort((a, b) => Date.parse(b.opened_at) - Date.parse(a.opened_at) || a.id.localeCompare(b.id))[0];
    if ((latest?.owned_by ?? userId) === userId) follows.add(memberId);
  }
  return follows;
}
