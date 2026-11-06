import { APP_URL, CHANGELOG_DIGEST_STARTS_ON, ORG_TIMEZONE, SLACK_CHANGELOG_CHANNEL_ID } from "@/lib/config";
import type { OutboundMessage } from "@/lib/channels";
import { slackBlocks } from "@/lib/channels/slack";
import { CHANGELOG_ENTRIES, type ChangelogEntry } from "@/lib/changelog/entries";
import { changelogEntryPath, listProductChangelog } from "@/lib/changelog";
import type { Repos } from "@/lib/data/repos";
import { chunk } from "@/lib/supabase/paginate";
import { createNotifier } from "@/lib/notifications/notify";
import { escapeSlackText, postToSlackChannel } from "@/lib/slack";

type DigestRepos = Repos;

/** The notification kind (lib/notifications/registry.ts) and the `notification_log` kind both use this id. */
export const CHANGELOG_DIGEST_KIND = "changelog_digest" as const;

/**
 * How far back an unsent entry still goes in a digest. A member who was away, or a digest that missed a week, gets
 * the entries they haven't seen since; anything older is on /changelog but not worth a notification.
 */
export const DIGEST_WINDOW_DAYS = 30;

/** At most this many entries in one message (a busy reader skims three, and mutes five); the rest are a tap away on /changelog. */
const MAX_ENTRIES_PER_MESSAGE = 3;

/** What a reader cares about first: something new she can do, then an improvement, then a fix. */
const CATEGORY_RANK: Record<ChangelogEntry["category"], number> = { new: 0, improved: 1, fixed: 2 };

/** Most valuable first: major entries, then new, improved and fixed, keeping the date order (newest first) within each. */
export function rankByBenefit(entries: readonly ChangelogEntry[]): ChangelogEntry[] {
  const rank = (e: ChangelogEntry) => (e.major ? -1 : CATEGORY_RANK[e.category]);
  return entries.map((e, i) => ({ e, i })).sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i).map(({ e }) => e);
}

/** A message of only fixes is noise: it waits for the next entry that gives the reader something new. */
export const worthSending = (entries: readonly ChangelogEntry[]): boolean => entries.some((e) => e.category !== "fixed");

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH = 10;

/** Today in the org's timezone as YYYY-MM-DD. */
function orgDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Entries that can be sent now (newest first): product entries (engineering ones never leave CHANGELOG.md) from the last
 * DIGEST_WINDOW_DAYS days and no earlier than `startsOn`, so backfilled history is never notified.
 */
export function digestCandidates(
  now: Date,
  entries: readonly ChangelogEntry[] = CHANGELOG_ENTRIES,
  startsOn: string = CHANGELOG_DIGEST_STARTS_ON,
): ChangelogEntry[] {
  const windowStart = new Date(Date.parse(orgDay(now)) - DIGEST_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const cutoff = windowStart > startsOn ? windowStart : startsOn;
  return listProductChangelog(entries).filter((e) => e.date >= cutoff);
}

const entryUrl = (e: ChangelogEntry) => `${APP_URL}${changelogEntryPath(e.slug)}`;
const imageUrl = (e: ChangelogEntry) => (e.image ? `${APP_URL}${e.image.src}` : null);

/** The message for a member: one entry reads as that entry, several as a roundup that links to the list. */
export function digestMessage(entries: readonly ChangelogEntry[]): OutboundMessage {
  const ranked = rankByBenefit(entries);
  const shown = ranked.slice(0, MAX_ENTRIES_PER_MESSAGE);
  const single = shown.length === 1;
  const text = single ? shown[0].summary : shown.map((e) => `${e.title}: ${e.summary}`).join(" ");
  const blocks = shown.flatMap((e) => {
    const image = imageUrl(e);
    return [
      { type: "section", text: { type: "mrkdwn", text: `*<${entryUrl(e)}|${escapeSlackText(e.title)}>*\n${escapeSlackText(e.summary)}` } },
      ...(image ? [{ type: "image", image_url: image, alt_text: e.image!.alt }] : []),
    ];
  });
  const more = ranked.length - shown.length;
  // The Slack adapter ignores `url` when it is given blocks, so the link into the Hub is in them.
  const link = single
    ? `<${entryUrl(shown[0])}|Read more>`
    : `<${APP_URL}/changelog|${more > 0 ? `${more} more on the What's new page` : "See what's new"}>`;
  return {
    title: single ? shown[0].title : "What's new in the Hub",
    text,
    url: single ? entryUrl(shown[0]) : `${APP_URL}/changelog`,
    linkLabel: single ? "Read more" : "See what's new",
    slackBlocks: [
      ...(single ? [] : [{ type: "header", text: { type: "plain_text", text: "What's new in the Hub" } }]),
      ...blocks,
      { type: "context", elements: [{ type: "mrkdwn", text: link }] },
    ],
  };
}

export interface DigestResult {
  /** Members the digest reached on at least one channel. */
  sent: number;
  /** Members who would have got it had this been live for them (logged, nothing sent or recorded). */
  dryRun: number;
}

export interface DigestOptions {
  /** Which of these members get it for real; the rest are logged only. The route uses the `changelog_digest` flag. Default: everyone. */
  liveFor?: (memberIds: string[]) => Promise<Set<string>>;
  entries?: readonly ChangelogEntry[];
}

/**
 * One weekly pass: every active member gets the entries they haven't been sent in the last DIGEST_WINDOW_DAYS days, as
 * one message on the channels they chose for `changelog_digest`. Each entry is claimed per member in `notification_log`
 * before the send (so a retry or an overlapping run sends nothing twice), and given back when the message reached no
 * channel. A member with nothing new, or reachable nowhere, is skipped without a claim, so turning a channel on later
 * still delivers what they missed. Members this isn't live for are logged, with the message, and nothing else.
 */
export async function sendChangelogDigest(
  repos: DigestRepos,
  now: Date = new Date(),
  { liveFor = async (ids) => new Set(ids), entries = CHANGELOG_ENTRIES }: DigestOptions = {},
): Promise<DigestResult> {
  const candidates = digestCandidates(now, entries);
  if (candidates.length === 0) return { sent: 0, dryRun: 0 };
  const members = await repos.members.list({ status: "active" });
  const memberIds = members.map((m) => m.id);
  if (memberIds.length === 0) return { sent: 0, dryRun: 0 };

  const [live, notifier, alreadySent] = await Promise.all([
    liveFor(memberIds),
    createNotifier(repos, CHANGELOG_DIGEST_KIND, memberIds),
    repos.notificationLog.sentKeys(CHANGELOG_DIGEST_KIND, memberIds.map((memberId) => ({ memberId }))),
  ]);

  const result: DigestResult = { sent: 0, dryRun: 0 };
  const sendTo = async (memberId: string) => {
    const unsent = candidates.filter((e) => !alreadySent.get(memberId)?.has(e.slug));
    // Nothing, or only fixes: no claim, so the fixes go out with the next entry that has something new.
    if (!worthSending(unsent)) return;
    const message = digestMessage(unsent);
    if (!live.has(memberId)) {
      const channels = notifier.channelsFor(memberId);
      if (channels.length > 0) result.dryRun++;
      console.log(
        "[changelog-digest] DRY RUN",
        JSON.stringify({ memberId, wouldSend: channels.length > 0, channels, entries: unsent.map((e) => e.slug), text: message.text, url: message.url ?? null }),
      );
      return;
    }
    // Opted out everywhere, or no address: no claim, so turning a channel on later still sends what they missed.
    if (!notifier.canReach(memberId)) return;
    const claimed: ChangelogEntry[] = [];
    for (const e of unsent) if (await repos.notificationLog.claim({ memberId }, CHANGELOG_DIGEST_KIND, e.slug, now)) claimed.push(e);
    if (claimed.length === 0) return;
    const delivered = await notifier.send(memberId, digestMessage(claimed));
    if (delivered.length > 0) result.sent++;
    // Only a message that went nowhere can retry; a partial success stays claimed (as for every notification).
    else for (const e of claimed) await repos.notificationLog.release({ memberId }, CHANGELOG_DIGEST_KIND, e.slug);
  };

  for (const batch of chunk(memberIds, BATCH)) await Promise.all(batch.map(sendTo));
  return result;
}

export interface ChannelPostResult {
  /** Entries posted to the channel. */
  posted: number;
  /** Entries that would have been posted had this been live (logged only). */
  dryRun: number;
}

/** The roundup for the channel: the same entries as a member's message, with a link to the list. */
export function channelPost(entries: readonly ChangelogEntry[]): { text: string; blocks: any[] } {
  return {
    text: entries.length === 1 ? `What's new in the Hub: ${entries[0].title}` : "What's new in the Hub",
    blocks: slackBlocks(digestMessage(entries)),
  };
}

export interface ChannelPostOptions {
  /** Whether to post for real. The route uses "the digest flag is on for everyone"; anything else only logs. */
  live: boolean;
  entries?: readonly ChangelogEntry[];
  channelId?: string;
  post?: typeof postToSlackChannel;
}

/**
 * Posts the entries not yet in the announcements channel (the id is `slack.changelogChannelId` in app.config.ts; empty =
 * nowhere), claimed in `notification_log` under the channel like a member's, and given back when Slack refuses so the
 * next run tries again. Outside production `postToSlackChannel` logs and posts nothing, and the claims are given back.
 */
export async function postChangelogToChannel(
  repos: DigestRepos,
  now: Date = new Date(),
  { live, entries = CHANGELOG_ENTRIES, channelId = SLACK_CHANGELOG_CHANNEL_ID, post = postToSlackChannel }: ChannelPostOptions,
): Promise<ChannelPostResult> {
  if (!channelId) return { posted: 0, dryRun: 0 };
  const to = { place: `slack:${channelId}` };
  const sent = (await repos.notificationLog.sentKeys(CHANGELOG_DIGEST_KIND, [to])).get(to.place);
  const unsent = digestCandidates(now, entries).filter((e) => !sent?.has(e.slug));
  if (!worthSending(unsent)) return { posted: 0, dryRun: 0 };

  const { text, blocks } = channelPost(unsent);
  if (!live) {
    console.log("[changelog-digest] DRY RUN channel post", JSON.stringify({ channelId, entries: unsent.map((e) => e.slug), text }));
    return { posted: 0, dryRun: unsent.length };
  }

  const claimed: ChangelogEntry[] = [];
  for (const e of unsent) if (await repos.notificationLog.claim(to, CHANGELOG_DIGEST_KIND, e.slug, now)) claimed.push(e);
  if (claimed.length === 0) return { posted: 0, dryRun: 0 };
  const body = claimed.length === unsent.length ? { text, blocks } : channelPost(claimed);
  try {
    const posted = await post({ channel: channelId, ...body });
    if (posted) return { posted: claimed.length, dryRun: 0 };
  } catch (error) {
    console.error("[changelog-digest] posting to the channel failed", error);
  }
  for (const e of claimed) await repos.notificationLog.release(to, CHANGELOG_DIGEST_KIND, e.slug);
  return { posted: 0, dryRun: 0 };
}
