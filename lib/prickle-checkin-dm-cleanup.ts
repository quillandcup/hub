import type { WebClient } from "@slack/web-api";
import type { Repos } from "@/lib/data/repos";
import type { CheckinHalfKind } from "@/lib/data/prickle-activity";
import { resolveSlackUserIds } from "@/lib/slack-member-ids";
import { checkinAnswered, checkoutAnswered } from "@/lib/prickle-checkins";
import { closedDmBlocks } from "@/lib/prickle-checkin-dms";

const HALVES: { half: CheckinHalfKind; kind: "prickle_checkin" | "prickle_checkout"; answered: typeof checkinAnswered }[] = [
  { half: "checkin", kind: "prickle_checkin", answered: checkinAnswered },
  { half: "checkout", kind: "prickle_checkout", answered: checkoutAnswered },
];

export interface CloseDmsResult {
  /** Check-in or check-out halves that are done on the site, with a DM sent. */
  finished: number;
  /** DMs found still open for a finished half (closed unless dryRun). */
  open: number;
  closed: number;
  failed: number;
}

/**
 * One-off clean-up: the check-in and check-out DMs sent before they had a Submit button stay open
 * in people's inboxes even once the check-in is done on the site. For every DM sent since `since`
 * whose half is answered (the same test as the site's "Checked in"), finds the message in the
 * member's DM with the bot and collapses it to the closed note a submitted DM shows. The DM log
 * does not keep message timestamps, so it reads each member's DM history. Writes nothing to the
 * database, and a message already collapsed is not found again, so it is safe to re-run.
 */
export async function closeAnsweredCheckinDms(
  repos: Repos,
  slack: Pick<WebClient, "conversations" | "chat">,
  { since, dryRun = false }: { since: Date; dryRun?: boolean }
): Promise<CloseDmsResult> {
  const result: CloseDmsResult = { finished: 0, open: 0, closed: 0, failed: 0 };
  const prickles = await repos.prickles.startingBetween({ from: since.toISOString(), to: new Date().toISOString() });
  const prickleIds = prickles.map((p) => p.id);
  if (prickleIds.length === 0) return result;

  // `${half}:${prickleId}` the member has finished, by member.
  const finishedByMember = new Map<string, Set<string>>();
  for (const { half, kind, answered } of HALVES) {
    const sent = [...(await repos.prickleActivity.claimedDmPairs(kind, prickleIds))].map((pair) => pair.split(":") as [string, string]);
    const checkins = await repos.prickleActivity.checkinsOfMembers([...new Set(sent.map(([m]) => m))], prickleIds);
    for (const [memberId, prickleId] of sent) {
      if (!answered(checkins.get(`${memberId}:${prickleId}`) ?? null)) continue;
      result.finished++;
      const set = finishedByMember.get(memberId) ?? new Set<string>();
      set.add(`${half}:${prickleId}`);
      finishedByMember.set(memberId, set);
    }
  }

  const slackIds = await resolveSlackUserIds(repos, [...finishedByMember.keys()]);
  for (const [memberId, finished] of finishedByMember) {
    const slackUserId = slackIds.get(memberId);
    if (!slackUserId) continue;
    try {
      const opened = await slack.conversations.open({ users: slackUserId });
      const channel = opened.channel?.id;
      if (!channel) continue;
      const history = await slack.conversations.history({ channel, oldest: String(Math.floor(since.getTime() / 1000)), limit: 200 });
      for (const message of history.messages ?? []) {
        const blocks = (message.blocks ?? []) as { block_id?: string }[];
        const half = HALVES.map((h) => h.half).find((h) => blocks.some((b) => finished.has(blockKey(b.block_id, h))));
        if (!half || !message.ts) continue;
        result.open++;
        if (dryRun) continue;
        try {
          await slack.chat.update({ channel, ts: message.ts, ...closedDmBlocks(half) });
          result.closed++;
        } catch (error) {
          result.failed++;
          console.error("close checkin DM: update failed", { memberId, error });
        }
      }
    } catch (error) {
      result.failed++;
      console.error("close checkin DM: reading the member's DMs failed", { memberId, error });
    }
  }
  return result;
}

/** `${half}:${prickleId}` for a DM's "prickle_dismiss:<half>:<prickleId>" block, if `blockId` is one of that half's. */
function blockKey(blockId: string | undefined, half: CheckinHalfKind): string {
  const prefix = `prickle_dismiss:${half}:`;
  return blockId?.startsWith(prefix) ? `${half}:${blockId.slice(prefix.length)}` : "";
}
