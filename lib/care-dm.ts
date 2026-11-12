/**
 * Hedgie Care and Slack DMs (docs/HEDGIE_CARE.md, "Slack DMs fill it in"): which 1:1 DMs a staff member has with members,
 * which of them she tracks, and what the tracked ones say about who spoke last in an engagement.
 *
 * Privacy, the reasons for the shape of this file:
 * - **Metadata only.** Everything read from Slack's Bronze is who wrote and when (`SlackMessageRepository.lastWritesIn`,
 *   the content-free view). Message text, files and the raw payload are never read, returned, logged or stored.
 * - **Only her own DMs.** The list is built from the DMs her own Slack user is a participant of (`directMessagesOf`), never
 *   from a channel id someone supplies, so another person's DM can't appear, even to an admin. The projection re-checks
 *   that both people of a tracked DM are in the Slack conversation before it reads a word of metadata.
 * - **Staff are never offered.** A counterpart who is staff (`staff.member_id`, or a member behind an admin or community
 *   manager account) is dropped.
 * - The Bronze reads need the service role (Slack content is service role only), so every caller checks who is asking first
 *   (`requireStaffAction()` or the staff page, and `care.write`) and hands the service repositories in.
 */
import { daysAgoLabel } from "@/lib/care";
import { clock } from "@/lib/clock";
import { CARE_OWNER_ROLES } from "@/lib/care-owners";
import { derivedMessageTimes, lastWriter, type DmLastWrites } from "@/lib/care-dm-rules";
import type { CareEngagementWithMember } from "@/lib/data/care";
import { hasDmScopes } from "@/lib/slack-connect";
import { getMemberDisplayName } from "@/lib/member-display-name";
import type { Repos } from "@/lib/data/repos";

/** What the service-role side of these functions reads. */
export type CareDmServiceRepos = Pick<Repos, "slackWorkspace" | "slackMessages" | "chat" | "members" | "memberProfile" | "staff" | "profiles">;

/** A signed-in staff user, as much of them as is needed to find their Slack account. */
export type StaffIdentity = { id: string; email?: string | null };

/** The staff user's own member record and Slack connection (the one place their Slack user id comes from). */
export type OwnSlackIdentity = {
  /** Null when the staff user has no member record: no Slack account to connect. */
  memberId: string | null;
  /** Null when they never connected Slack. */
  slackUserId: string | null;
  /** The connection works now (not revoked by us because Slack stopped honouring it). */
  connected: boolean;
  /** The connection was granted the direct message permissions. */
  hasDmScopes: boolean;
};

/**
 * The staff user's member record (by their account, else their email, as the app finds the signed-in member) and the Slack
 * user id they connected. A revoked connection still names the Slack user (that id still belongs to them), so DMs already
 * in Bronze stay theirs; `connected` says whether it works now.
 */
export async function ownSlackIdentity(service: Pick<Repos, "members" | "memberProfile">, user: StaffIdentity): Promise<OwnSlackIdentity> {
  const member = (await service.members.byUserId(user.id)) ?? (user.email ? await service.members.byEmail(user.email) : null);
  if (!member) return { memberId: null, slackUserId: null, connected: false, hasDmScopes: false };
  const connection = await service.memberProfile.slackConnectionOf(member.id);
  if (!connection) return { memberId: member.id, slackUserId: null, connected: false, hasDmScopes: false };
  const connected = connection.revoked_at === null;
  return { memberId: member.id, slackUserId: connection.slack_user_id, connected, hasDmScopes: connected && hasDmScopes((connection.scopes as string[] | null) ?? []) };
}

/** Member ids that are staff: the `staff` table's links, and the members behind admin and community manager accounts. */
export async function staffMemberIds(service: Pick<Repos, "staff" | "profiles" | "members">): Promise<Set<string>> {
  const [staff, accounts] = await Promise.all([service.staff.all(), service.profiles.byRoles([...CARE_OWNER_ROLES])]);
  const behindAccounts = await service.members.idsByUserId(accounts.map((a) => a.id));
  return new Set([...staff.map((s) => s.member_id).filter((id): id is string => !!id), ...behindAccounts.values()]);
}

/** One of her 1:1 DMs with a member who is not staff. */
export type OwnDm = {
  /** The Slack DM conversation id. */
  channelId: string;
  /** The Slack user on the other side. */
  counterpartSlackId: string;
  /** The Hub member they are. */
  memberId: string;
};

/**
 * The 1:1 DMs this Slack user is in, with Hub members who are not staff: the whole list she may track, and the only one.
 * A DM with herself, with someone the Hub has not matched to a member, with a staff member, or a group DM, is not in it.
 * By channel id.
 */
export async function ownDirectMessages(service: CareDmServiceRepos, slackUserId: string, selfMemberId: string | null): Promise<OwnDm[]> {
  const dms = await service.slackWorkspace.directMessagesOf(slackUserId);
  const counterparts = dms.map((dm) => ({ channelId: dm.channel_id, others: dm.participants.filter((p) => p !== slackUserId), size: dm.participants.length }));
  // A 1:1 has exactly two people in it, her and one other.
  const pairs = counterparts.filter((c) => c.size === 2 && c.others.length === 1).map((c) => ({ channelId: c.channelId, counterpartSlackId: c.others[0] }));
  if (pairs.length === 0) return [];
  const [members, staff] = await Promise.all([service.chat.memberIdsBySlackUser(pairs.map((p) => p.counterpartSlackId)), staffMemberIds(service)]);
  const out: OwnDm[] = [];
  for (const pair of pairs) {
    const memberId = members.get(pair.counterpartSlackId);
    if (!memberId || memberId === selfMemberId || staff.has(memberId)) continue;
    out.push({ ...pair, memberId });
  }
  return out;
}

/** What the DM list shows about one DM. No text, ever. */
export type CareDmRow = {
  channelId: string;
  memberId: string;
  /** The name the community knows them by (CLAUDE.md, "Display Names"). */
  memberName: string;
  /** The legal name, only when it differs. */
  legalName: string | null;
  tracked: boolean;
  /** When anyone last wrote in it (ISO), or null when Bronze has no message. */
  lastAt: string | null;
  /** "3 days ago", worked out on the server; null with no message. */
  lastLabel: string | null;
  /** Who wrote last: she did, or they did. */
  lastBy: "you" | "them" | null;
};

/** Why the list isn't shown, and what to do about it. */
export type CareDmUnavailable = "no_member" | "flag_off" | "not_connected" | "needs_reconnect";

export type CareDmTab = { state: "unavailable"; reason: CareDmUnavailable } | { state: "ready"; rows: CareDmRow[] };

const byLastThenName = (a: CareDmRow, b: CareDmRow) => {
  if (a.lastAt !== b.lastAt) {
    if (a.lastAt === null) return 1;
    if (b.lastAt === null) return -1;
    return a.lastAt < b.lastAt ? 1 : -1;
  }
  return a.memberName.localeCompare(b.memberName) || (a.channelId < b.channelId ? -1 : a.channelId > b.channelId ? 1 : 0);
};

/** Her last-written times from Bronze for each DM: her messages are the staff side, the counterpart's the member side. */
async function writesByChannel(service: Pick<Repos, "slackMessages">, dms: readonly OwnDm[], slackUserId: string): Promise<Map<string, DmLastWrites>> {
  const asked = new Map(dms.map((dm) => [dm.channelId, dm.counterpartSlackId]));
  const writes = new Map<string, DmLastWrites>(dms.map((dm) => [dm.channelId, { staffAt: null, memberAt: null }]));
  for (const row of await service.slackMessages.lastWritesIn([...asked.keys()])) {
    const entry = writes.get(row.channel_id);
    if (!entry) continue;
    // Anyone else in the conversation (a bot) is ignored: only the two people count.
    if (row.user_id === slackUserId) entry.staffAt = row.last_at;
    else if (row.user_id === asked.get(row.channel_id)) entry.memberAt = row.last_at;
  }
  return writes;
}

/**
 * The "Your DMs with members" list for a signed-in staff user. `bridgeOn` is whether the Slack DM bridge feature is on for
 * them (the caller reads their flags); `service` reads Bronze, `trackedChannelIds` is their own tracked list read with their
 * own client. Scoped to their Slack user, so it never holds anyone else's DM.
 */
export async function loadCareDmTab(
  service: CareDmServiceRepos,
  user: StaffIdentity,
  options: { bridgeOn: boolean; trackedChannelIds: ReadonlySet<string>; now: Date }
): Promise<CareDmTab> {
  const own = await ownSlackIdentity(service, user);
  if (!own.memberId) return { state: "unavailable", reason: "no_member" };
  if (!options.bridgeOn) return { state: "unavailable", reason: "flag_off" };
  if (!own.connected || !own.slackUserId) return { state: "unavailable", reason: "not_connected" };
  if (!own.hasDmScopes) return { state: "unavailable", reason: "needs_reconnect" };

  const dms = await ownDirectMessages(service, own.slackUserId, own.memberId);
  if (dms.length === 0) return { state: "ready", rows: [] };
  const [writes, members] = await Promise.all([writesByChannel(service, dms, own.slackUserId), service.members.byIds([...new Set(dms.map((dm) => dm.memberId))])]);
  const byId = new Map(members.map((m) => [m.id, m]));
  const rows: CareDmRow[] = [];
  for (const dm of dms) {
    const member = byId.get(dm.memberId);
    if (!member) continue;
    const shown = getMemberDisplayName({ name: member.name, display_name: member.displayName });
    const last = lastWriter(writes.get(dm.channelId) ?? { staffAt: null, memberAt: null });
    rows.push({
      channelId: dm.channelId,
      memberId: dm.memberId,
      memberName: shown,
      legalName: shown !== member.name ? member.name : null,
      tracked: options.trackedChannelIds.has(dm.channelId),
      lastAt: last?.at ?? null,
      lastLabel: last ? daysAgoLabel(last.at, options.now) : null,
      lastBy: last ? (last.who === "staff" ? "you" : "them") : null,
    });
  }
  return { state: "ready", rows: rows.sort(byLastThenName) };
}

/** Finds one of her own DMs by Slack conversation id, or null when it is not one of hers (not hers, a staff member's, a group, unknown). */
export async function findOwnDm(service: CareDmServiceRepos, user: StaffIdentity, channelId: string): Promise<OwnDm | null> {
  const own = await ownSlackIdentity(service, user);
  if (!own.slackUserId) return null;
  return (await ownDirectMessages(service, own.slackUserId, own.memberId)).find((dm) => dm.channelId === channelId) ?? null;
}

/** Her own DM with this member, if she has one (the auto-track when she starts a Slack DM engagement). */
export async function findOwnDmWith(service: CareDmServiceRepos, user: StaffIdentity, memberId: string): Promise<OwnDm | null> {
  const own = await ownSlackIdentity(service, user);
  if (!own.slackUserId) return null;
  return (await ownDirectMessages(service, own.slackUserId, own.memberId)).find((dm) => dm.memberId === memberId) ?? null;
}

/** The Slack DM channel ids a staff user tracks, for marking the list and the "from Slack" hint. */
export async function trackedChannelIds(careDms: Pick<Repos, "careDms">["careDms"], userId: string): Promise<Set<string>> {
  return new Set((await careDms.forUser(userId)).map((dm) => dm.channelId));
}

// ---------------------------------------------------------------------------------------------------------------------
// The projection: tracked DMs -> an open engagement's "who spoke last".
// ---------------------------------------------------------------------------------------------------------------------

/** Which tracked DMs to project: one staff user's, one Slack DM's (a live message arrived), or everyone's (the nightly run). */
export type ProjectionScope = { userId: string } | { channelId: string } | "all";

export type ProjectionResult = {
  /** Tracked DMs looked at. */
  tracked: number;
  /** Open Slack DM engagements those matched. */
  engagements: number;
  /** Times moved forward (a staff or a member time on an engagement). */
  moved: number;
  /** Stopped before the end because the time given was up (the next run carries on: it only ever moves times forward). */
  incomplete: boolean;
};

/**
 * Sets `last_staff_message_at` / `last_member_message_at` on OPEN Slack DM engagements from the DMs their owner tracks.
 *
 * The rule (docs/HEDGIE_CARE.md): for an open engagement with channel `slack_dm`, owned by the staff user who tracks the DM
 * with that member (`owned_by`, else who opened it), the staff side is the latest message the staff user's Slack account wrote
 * in that DM and the member side the latest the member's wrote; thread replies and file shares count, deleted messages and
 * Slack's join and leave notices do not, anyone else in the conversation is ignored. Only a message on or after the start of
 * the Eastern day the engagement opened counts (`dmCountsFrom`), and a time only ever moves FORWARD (`moveMessageTimesForward`),
 * so running it again, or after a manual "they replied", changes nothing it should not. It is rebuildable from Bronze at any
 * time. No audit rows: those two columns are left out of the audit trigger.
 *
 * `care` writes the engagements (a staff member's own client when she opens the page: RLS lets staff update; the service role
 * in the nightly run and the webhook); `careDms` reads the tracked list (her own, or everyone's with the service role);
 * `service` reads Bronze. A tracked DM whose conversation does not have both people in it is skipped, so a row that names a
 * channel that is not theirs reads nothing.
 */
export async function projectCareFromDms(
  deps: { care: Pick<Repos, "care">["care"]; careDms: Pick<Repos, "careDms">["careDms"]; service: CareDmServiceRepos },
  scope: ProjectionScope,
  options: { deadline?: number } = {}
): Promise<ProjectionResult> {
  const { care, careDms, service } = deps;
  const result: ProjectionResult = { tracked: 0, engagements: 0, moved: 0, incomplete: false };
  const outOfTime = () => options.deadline !== undefined && clock.now() >= options.deadline;
  const tracked = scope === "all" ? await careDms.allLive() : "userId" in scope ? await careDms.forUser(scope.userId) : await careDms.forChannel(scope.channelId);
  result.tracked = tracked.length;
  if (tracked.length === 0) return result;

  const engagements = (await care.list()).filter((e) => e.channel === "slack_dm" && e.closed_at === null);
  if (engagements.length === 0) return result;
  const ownerOf = (e: CareEngagementWithMember) => e.owned_by ?? e.opened_by;

  // Only the tracked DMs that an open Slack DM engagement of the same owner and member could use.
  const wanted = tracked.filter((dm) => engagements.some((e) => ownerOf(e) === dm.trackedBy && e.member_id === dm.memberId));
  if (wanted.length === 0) return result;

  // Each tracking user's own Slack id and the DMs they are really in (re-checked against Bronze, with the counterpart's member).
  const slackIdOf = new Map<string, { slackUserId: string; dms: Map<string, OwnDm> }>();
  const userIds = [...new Set(wanted.map((dm) => dm.trackedBy))];
  const emails = new Map((await service.profiles.byIds(userIds)).map((p) => [p.id, p.email]));
  for (const userId of userIds) {
    if (outOfTime()) {
      result.incomplete = true;
      return result;
    }
    const own = await ownSlackIdentity(service, { id: userId, email: emails.get(userId) });
    if (!own.slackUserId) continue;
    const dms = await ownDirectMessages(service, own.slackUserId, own.memberId);
    slackIdOf.set(userId, { slackUserId: own.slackUserId, dms: new Map(dms.map((dm) => [dm.channelId, dm])) });
  }

  if (outOfTime()) {
    result.incomplete = true;
    return result;
  }
  const valid = wanted.filter((dm) => slackIdOf.get(dm.trackedBy)?.dms.get(dm.channelId)?.memberId === dm.memberId);
  if (valid.length === 0) return result;
  const lasts = new Map<string, { channel: string; user: string; at: string }[]>();
  for (const row of await service.slackMessages.lastWritesIn([...new Set(valid.map((dm) => dm.channelId))])) {
    const list = lasts.get(row.channel_id) ?? [];
    list.push({ channel: row.channel_id, user: row.user_id, at: row.last_at });
    lasts.set(row.channel_id, list);
  }

  for (const dm of valid) {
    if (outOfTime()) {
      result.incomplete = true;
      return result;
    }
    const own = slackIdOf.get(dm.trackedBy);
    const counterpart = own?.dms.get(dm.channelId)?.counterpartSlackId;
    if (!own || !counterpart) continue;
    const writes: DmLastWrites = { staffAt: null, memberAt: null };
    for (const row of lasts.get(dm.channelId) ?? []) {
      if (row.user === own.slackUserId) writes.staffAt = row.at;
      else if (row.user === counterpart) writes.memberAt = row.at;
    }
    for (const engagement of engagements) {
      if (ownerOf(engagement) !== dm.trackedBy || engagement.member_id !== dm.memberId) continue;
      result.engagements += 1;
      const times = derivedMessageTimes(engagement, writes);
      if (times.staffAt || times.memberAt) result.moved += await care.moveMessageTimesForward(engagement.id, times);
    }
  }
  return result;
}
