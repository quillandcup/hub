/**
 * Hedgie Care and Slack DMs (docs/product/HEDGIE_CARE.md, "Slack DMs fill it in"): which 1:1 DM a staff member has with a member who
 * is theirs to care for, which of those are tracked (every one whose staff member holds a care plan with the member: there is
 * no choice to make), and what the tracked ones say about who spoke last in an engagement.
 *
 * Privacy, the reasons for the shape of this file:
 * - **Metadata only.** Everything read from Slack's Bronze is who wrote and when (`SlackMessageRepository.lastWritesIn`,
 *   the content-free view). Message text, files and the raw payload are never read, returned, logged or stored.
 * - **Only her own DMs.** The list is built from the DMs her own Slack user is a participant of (`directMessagesOf`), never
 *   from a channel id someone supplies, so another person's DM can't appear, even to an admin. The projection re-checks
 *   that both people of a tracked DM are in the Slack conversation before it reads a word of metadata.
 * - **Staff are never offered.** A counterpart who is staff (`StaffRepository.memberIds()`: `staff.member_id`, or a member
 *   behind an admin, assistant or community manager account; the one definition) is dropped.
 * - The Bronze reads need the service role (Slack content is service role only), so every caller checks who is asking first
 *   (`requireStaffAction()` or the staff page, and `care.write`) and hands the service repositories in.
 */
import { clock } from "@/lib/clock";
import { careOwnerOf, derivedMessageTimes, type DmLastWrites } from "@/lib/care-dm-rules";
import type { CareEngagementWithMember } from "@/lib/data/care";
import type { TrackedDm } from "@/lib/data/care-dms";
import { hasDmScopes } from "@/lib/slack-connect";
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
  const [members, staff] = await Promise.all([service.chat.memberIdsBySlackUser(pairs.map((p) => p.counterpartSlackId)), service.staff.memberIds()]);
  const out: OwnDm[] = [];
  for (const pair of pairs) {
    const memberId = members.get(pair.counterpartSlackId);
    if (!memberId || memberId === selfMemberId || staff.has(memberId)) continue;
    out.push({ ...pair, memberId });
  }
  return out;
}

/**
 * Whether her own Slack DMs can fill in her care plans, from her Slack connection and whether the Slack DM bridge is on for her:
 * `ready`, `needs_slack` (not connected, the DM permissions not granted, or the bridge not on for her: the page offers to connect
 * Slack) or `no_member` (her account has no member profile, so there is no Slack account to connect: nothing is offered).
 */
export type OwnDmAccess = "ready" | "needs_slack" | "no_member";

export function ownDmAccess(own: OwnSlackIdentity, bridgeOn: boolean): OwnDmAccess {
  if (!own.memberId) return "no_member";
  if (!bridgeOn || !own.connected || !own.slackUserId || !own.hasDmScopes) return "needs_slack";
  return "ready";
}

/** Her own DM with this member, if she has one (what starting a care plan with them tracks). */
export async function findOwnDmWith(service: CareDmServiceRepos, user: StaffIdentity, memberId: string): Promise<OwnDm | null> {
  const own = await ownSlackIdentity(service, user);
  if (!own.slackUserId) return null;
  return (await ownDirectMessages(service, own.slackUserId, own.memberId)).find((dm) => dm.memberId === memberId) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The projection: tracked DMs -> an open care plan's "who spoke last".
// ---------------------------------------------------------------------------------------------------------------------

/** Which tracked DMs to project: one staff user's, one Slack DM's (a live message arrived), or everyone's (the nightly run). */
export type ProjectionScope = { userId: string } | { channelId: string } | "all";

export type ProjectionResult = {
  /** Tracked DMs looked at (after the ones tracked for an owner's open plans, below). */
  tracked: number;
  /** DMs tracked by this run because their owner holds an open care plan with the member. */
  autoTracked: number;
  /** Open care plans those matched. */
  engagements: number;
  /** Times moved forward (a staff or a member time on a care plan). */
  moved: number;
  /** Stopped before the end because the time given was up (the next run carries on: it only ever moves times forward). */
  incomplete: boolean;
};

type ProjectionDeps = { care: Pick<Repos, "care">["care"]; careDms: Pick<Repos, "careDms">["careDms"]; service: CareDmServiceRepos };

/**
 * Tracks the DM of an owner of an open care plan with the member, when she has a 1:1 DM with them in Bronze and does not track
 * it yet. A care plan is the reason a DM is tracked, so this is how one that was not tracked at the start (a DM that reached
 * Bronze later, a plan started before the DM was pulled, a plan handed to her) comes in. Never a DM with staff
 * (`ownDirectMessages` leaves them out). Returns the rows it added.
 */
async function trackOwnersDms(deps: ProjectionDeps, scope: ProjectionScope, tracked: readonly TrackedDm[], engagements: readonly CareEngagementWithMember[], outOfTime: () => boolean): Promise<{ added: TrackedDm[]; incomplete: boolean }> {
  const { careDms, service } = deps;
  // Owner -> the members they hold an open plan with and track no DM of.
  const missing = new Map<string, Set<string>>();
  for (const engagement of engagements) {
    const owner = careOwnerOf(engagement);
    if (!owner || (scope !== "all" && "userId" in scope && owner !== scope.userId)) continue;
    if (tracked.some((dm) => dm.trackedBy === owner && dm.memberId === engagement.member_id)) continue;
    missing.set(owner, (missing.get(owner) ?? new Set()).add(engagement.member_id));
  }
  if (missing.size === 0) return { added: [], incomplete: false };

  const ownerIds = [...missing.keys()];
  const emails = new Map((await service.profiles.byIds(ownerIds)).map((p) => [p.id, p.email]));
  const added: TrackedDm[] = [];
  for (const [owner, memberIds] of missing) {
    if (outOfTime()) return { added, incomplete: true };
    const own = await ownSlackIdentity(service, { id: owner, email: emails.get(owner) });
    if (!own.slackUserId) continue;
    for (const dm of await ownDirectMessages(service, own.slackUserId, own.memberId)) {
      if (!memberIds.has(dm.memberId)) continue;
      added.push((await careDms.track({ trackedBy: owner, channelId: dm.channelId, memberId: dm.memberId })).dm);
    }
  }
  return { added, incomplete: false };
}

/**
 * Sets `last_staff_message_at` / `last_member_message_at` on OPEN care plans from the DM their owner has with the member.
 *
 * The rule (docs/product/HEDGIE_CARE.md): a care plan belongs to the member, not to a channel, so for an open plan owned by the staff
 * user who tracks the DM with that member (`owned_by`; a plan with no owner reads no one's DM), the staff side is the latest message the staff
 * user's Slack account wrote in that DM and the member side the latest the member's wrote; thread replies and file shares count,
 * deleted messages and Slack's join and leave notices do not, anyone else in the conversation is ignored. Only a message on or
 * after the start of the Eastern day the plan opened counts (`dmCountsFrom`), and a time only ever moves FORWARD
 * (`moveMessageTimesForward`), so running it again, or after a manual "they replied", changes nothing it should not. It is
 * rebuildable from Bronze at any time. No audit rows: those two columns are left out of the audit trigger.
 *
 * First it tracks the owner's DM with the member when she holds an open plan and has a DM but no tracking (`trackOwnersDms`); that is not done for a single Slack DM's live message (`{ channelId }`), which only reads what is
 * already tracked.
 *
 * `care` writes the plans (a staff member's own client when she opens the page: RLS lets staff update; the service role
 * in the nightly run and the webhook); `careDms` reads the tracked list (her own, or everyone's with the service role);
 * `service` reads Bronze. A tracked DM whose conversation does not have both people in it is skipped, so a row that names a
 * channel that is not theirs reads nothing.
 */
export async function projectCareFromDms(deps: ProjectionDeps, scope: ProjectionScope, options: { deadline?: number } = {}): Promise<ProjectionResult> {
  const { care, careDms, service } = deps;
  const result: ProjectionResult = { tracked: 0, autoTracked: 0, engagements: 0, moved: 0, incomplete: false };
  const outOfTime = () => options.deadline !== undefined && clock.now() >= options.deadline;
  let tracked = scope === "all" ? await careDms.allLive() : "userId" in scope ? await careDms.forUser(scope.userId) : await careDms.forChannel(scope.channelId);
  result.tracked = tracked.length;

  const engagements = (await care.list()).filter((e) => e.closed_at === null);
  if (engagements.length === 0) return result;
  const ownerOf = (e: CareEngagementWithMember) => careOwnerOf(e);

  if (scope === "all" || "userId" in scope) {
    const auto = await trackOwnersDms(deps, scope, tracked, engagements, outOfTime);
    tracked = [...tracked, ...auto.added];
    result.autoTracked = auto.added.length;
    result.tracked = tracked.length;
    if (auto.incomplete) {
      result.incomplete = true;
      return result;
    }
  }
  if (tracked.length === 0) return result;

  // Only the tracked DMs that an open care plan of the same owner and member could use.
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
