/**
 * The messages of a member's care plans (docs/HEDGIE_CARE.md, "Plan messages"): the full text of the DM(s) a staff member tracks with
 * that member, sent inside the windows of the member's care plans, shown in Hedgie Care to admins and community managers.
 *
 * What makes this safe to read with the service role (Slack content is service role only):
 * - **Who asks is checked first**, by the caller (`requireStaffAction()` and `staffCan(role, "care.write")`), which also puts the read on
 *   record (`CareRepository.logMessagesRead`) before anything is read. This file never decides who may read.
 * - **Which conversations** comes from the database, never from the request: a DM is read only if it is tracked (`care_tracked_dms`, live)
 *   by someone who owns a care plan of THIS member (the owner, else who opened it, `careOwnerOf`). The caller supplies a member id and a
 *   cursor, nothing else.
 * - **Which messages**: those sent inside a plan's window, from its start (`opened_at`) to its end (`closed_at`, or now while it is open;
 *   the end is not included, so two plans that follow each other never claim the same message). A message in no window is never read.
 *   Deleted messages and the notices Slack posts itself are left out (`SlackMessageRepository.dmMessagesBetween`).
 * - **Per member, across plans and owners**: a new owner of a plan sees the member's earlier plans, and so does the owner of a later one.
 *   The messages come from the DMs of every owner of the member's plans that is still tracked, so they stay readable after a plan is
 *   reassigned or an owner leaves; a new owner's own DM with the member is a different Slack conversation and is captured only once they track it.
 */
import { clock } from "@/lib/clock";
import { careOwnerOf } from "@/lib/care-dm-rules";
import { getMemberDisplayName } from "@/lib/member-display-name";
import { decodeEntities, mentionsToPlainText } from "@/lib/chat/render";
import type { CareEngagementRow } from "@/lib/data/care";
import type { SlackDmMessage } from "@/lib/data/slack-messages";
import type { Repos } from "@/lib/data/repos";

/** Messages on a page. */
export const CARE_MESSAGES_PAGE = 50;

/** What the loader reads, all through the service role (the caller has checked who is asking). */
export type CareMessagesRepos = Pick<Repos, "care" | "careDms" | "slackMessages" | "chat" | "members" | "directory">;

/** One care plan of the member: when it ran and who owned it. */
export type CareMessagesPlan = { id: string; openedAt: string; closedAt: string | null; ownerName: string };

/** One message, ready to draw: who wrote it, when, and the text as sent (never shortened). */
export type CareMessage = {
  /** Unique across conversations: the Slack conversation and the message's own time stamp. */
  key: string;
  planId: string;
  at: string;
  fromMember: boolean;
  author: string;
  text: string;
  hasFiles: boolean;
};

/** A page of the member's plan messages: every plan (newest first, for the headings), the messages of this page, and where the older ones start. */
export type CareMessagesPage = {
  plans: CareMessagesPlan[];
  /** Newest first. */
  messages: CareMessage[];
  /** Pass back as `before` for the next older page; null when there are no older messages. */
  olderBefore: string | null;
  /** Whether any DM with this member is tracked for one of their plans at all (false: nothing to read, and the panel says so). */
  tracked: boolean;
};

type Window = { plan: CareEngagementRow; from: string; to: string };

/** A plan's window: [start, end), the end being its close or, while open, now. */
export function planWindow(plan: Pick<CareEngagementRow, "opened_at" | "closed_at">, now: Date): { from: string; to: string } {
  return { from: new Date(plan.opened_at).toISOString(), to: new Date(plan.closed_at ?? now).toISOString() };
}

/**
 * The newest plan whose window holds this moment, or null. Plans are given newest first (`CareRepository.forMember` order), so a moment two
 * windows share (plans of different channels can overlap) is shown once, under the newest.
 */
export function planOf(windows: readonly Window[], at: string): CareEngagementRow | null {
  const t = Date.parse(at);
  return windows.find((w) => t >= Date.parse(w.from) && t < Date.parse(w.to))?.plan ?? null;
}

/** Slack's own text as plain text: entities decoded, mentions as names. */
export function plainSlackText(text: string): string {
  return decodeEntities(mentionsToPlainText(text, { userNames: {}, channelNames: {} }));
}

/**
 * One page of a member's plan messages, newest first. `before` (an instant from a previous page's `olderBefore`) asks for older ones.
 * Reads nothing, and says so (`tracked: false`), when no DM with the member is tracked by an owner of one of their plans.
 */
export async function loadCareMessages(
  repos: CareMessagesRepos,
  memberId: string,
  options: { before?: string | null; now?: Date } = {}
): Promise<CareMessagesPage> {
  const now = options.now ?? new Date(clock.now());
  const plans = await repos.care.forMember(memberId); // newest first, removed ones left out
  const owners = new Set(plans.map((p) => careOwnerOf(p)).filter((id): id is string => !!id));
  // The DMs holding the messages: tracked by an owner of one of this member's plans.
  const dms = (await repos.careDms.forMember(memberId)).filter((d) => owners.has(d.trackedBy));
  const trackers = [...new Set(dms.map((d) => d.trackedBy))];

  const [people, trackerMembers] = await Promise.all([
    repos.directory.byIds([memberId]),
    Promise.all([...new Set([...owners, ...trackers])].map(async (id) => [id, await repos.members.byUserId(id)] as const)),
  ]);
  const nameOfUser = new Map(trackerMembers.map(([id, m]) => [id, m ? getMemberDisplayName({ name: m.name, display_name: m.displayName }) : "Someone from the team"]));
  const memberName = people[0] ? getMemberDisplayName({ name: people[0].name, display_name: people[0].display_name }) : "The member";
  const planList: CareMessagesPlan[] = plans.map((p) => ({
    id: p.id,
    openedAt: new Date(p.opened_at).toISOString(),
    closedAt: p.closed_at ? new Date(p.closed_at).toISOString() : null,
    ownerName: nameOfUser.get(careOwnerOf(p) ?? "") ?? "Unassigned",
  }));
  if (dms.length === 0 || plans.length === 0) return { plans: planList, messages: [], olderBefore: null, tracked: false };

  const windows: Window[] = plans.map((plan) => ({ plan, ...planWindow(plan, now) }));
  const before = options.before && !Number.isNaN(Date.parse(options.before)) ? new Date(options.before).toISOString() : null;

  // Each conversation and window is read up to one page past the cursor; the newest of all of them make the page.
  const found = new Map<string, SlackDmMessage & { tracker: string }>();
  await Promise.all(
    [...new Map(dms.map((d) => [d.channelId, d])).values()].flatMap((dm) =>
      windows.map(async (w) => {
        const to = before && Date.parse(before) < Date.parse(w.to) ? before : w.to;
        if (Date.parse(to) <= Date.parse(w.from)) return;
        for (const m of await repos.slackMessages.dmMessagesBetween(dm.channelId, w.from, to, CARE_MESSAGES_PAGE + 1)) {
          found.set(`${m.channel_id}|${m.message_ts}`, { ...m, tracker: dm.trackedBy });
        }
      })
    )
  );
  const ordered = [...found.values()].sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || (a.message_ts < b.message_ts ? 1 : -1));
  const page = ordered.slice(0, CARE_MESSAGES_PAGE);
  const hasMore = ordered.length > CARE_MESSAGES_PAGE;

  // Who wrote each one: the member (the Slack user matched to them) or the staff member whose DM it is.
  const slackIds = [...new Set(page.map((m) => m.user_id))];
  const memberBySlack = slackIds.length > 0 ? await repos.chat.memberIdsBySlackUser(slackIds) : new Map<string, string>();
  const messages: CareMessage[] = page.flatMap((m) => {
    const plan = planOf(windows, m.occurred_at);
    if (!plan) return [];
    const fromMember = memberBySlack.get(m.user_id) === memberId;
    return [
      {
        key: `${m.channel_id}|${m.message_ts}`,
        planId: plan.id,
        at: m.occurred_at,
        fromMember,
        author: fromMember ? memberName : (nameOfUser.get(m.tracker) ?? "Someone from the team"),
        text: plainSlackText(m.text),
        hasFiles: m.has_files,
      },
    ];
  });
  return { plans: planList, messages, olderBefore: hasMore && page.length > 0 ? page[page.length - 1].occurred_at : null, tracked: true };
}
