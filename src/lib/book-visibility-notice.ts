import { APP_URL } from "@/lib/config";
import type { OutboundMessage } from "@/lib/channels";
import type { Repos } from "@/lib/data/repos";
import { chunk } from "@/lib/supabase/paginate";
import { createNotifier } from "@/lib/notifications/notify";

/**
 * The one-time heads-up to each member whose published books were put on the public Hedgie Bookshelf (docs/product/WRITER_PROFILES.md,
 * "The public Hedgie Bookshelf"): the list members sent in through a form was already public, so every existing book starts at the
 * globe, and this tells each member, with the link to the place where each book has its own control (lock, house, globe).
 *
 * Sent through the notifier as the `book_visibility_notice` kind, on the channels each member chose. The claim is one row per member in
 * `notification_log` (key `NOTICE_KEY`), taken before the send and given back when the message reached no channel. It starts in dry
 * run: the `book_visibility_notice` flag says who gets it for real; for everyone else the job logs the member, why, the channels and
 * the message, and writes no claim, so switching it on later starts from a clean slate.
 */

export const BOOK_VISIBILITY_NOTICE_KIND = "book_visibility_notice" as const;
/** What "the same thing" means for the claim: one note per member, whatever happens to their books afterwards. */
export const BOOK_VISIBILITY_NOTICE_KEY = "public-bookshelf";

/** My Writing, Books: every book has its own control there. */
export const BOOKS_CONTROL_PATH = "/projects/books";

const BATCH = 10;

/** The message for a member with this many books at the globe. One link, to where each book's control is. */
export function bookVisibilityNoticeMessage(bookCount: number): OutboundMessage {
  const many = bookCount > 1;
  const text = many
    ? "Your published books are on the Hedgie Bookshelf, which anyone can see. You can hide them or limit them to members in My Writing any time."
    : "Your published book is on the Hedgie Bookshelf, which anyone can see. You can hide it or limit it to members in My Writing any time.";
  const url = `${APP_URL}${BOOKS_CONTROL_PATH}`;
  const linkLabel = many ? "Choose who sees each book" : "Choose who sees your book";
  return {
    title: many ? "Your books are on the Hedgie Bookshelf" : "Your book is on the Hedgie Bookshelf",
    text,
    url,
    linkLabel,
    // The Slack adapter ignores `url` when it is given blocks, so the link into the Hub is in them.
    slackBlocks: [
      { type: "section", text: { type: "mrkdwn", text } },
      { type: "context", elements: [{ type: "mrkdwn", text: `<${url}|${linkLabel}>` }] },
    ],
  };
}

export interface BookVisibilityNoticeResult {
  /** Members the note reached on at least one channel. */
  sent: number;
  /** Members who would have been told had this been live for them (logged, nothing sent or recorded). */
  dryRun: number;
}

export interface BookVisibilityNoticeOptions {
  /** Which of these members get it for real; the rest are logged only. The route uses the `book_visibility_notice` flag. Default: nobody, so a missing switch can never send. */
  liveFor?: (memberIds: string[]) => Promise<Set<string>>;
}

/**
 * One pass: every active member with at least one live book at the globe who has not been told yet gets the note on the channels they
 * chose. Idempotent: a second run tells nobody twice. A member reachable nowhere, or opted out everywhere, is skipped without a claim,
 * so turning a channel on later still tells them. Members this isn't live for are logged with the message, and nothing else.
 */
export async function sendBookVisibilityNotices(
  repos: Repos,
  now: Date = new Date(),
  { liveFor = async () => new Set<string>() }: BookVisibilityNoticeOptions = {},
): Promise<BookVisibilityNoticeResult> {
  const result: BookVisibilityNoticeResult = { sent: 0, dryRun: 0 };
  const [counts, members] = await Promise.all([repos.books.publicBookCountsByMember(), repos.members.list({ status: "active" })]);
  const memberIds = members.map((m) => m.id).filter((id) => counts.has(id));
  if (memberIds.length === 0) return result;

  const [live, notifier, told] = await Promise.all([
    liveFor(memberIds),
    createNotifier(repos, BOOK_VISIBILITY_NOTICE_KIND, memberIds),
    repos.notificationLog.sentKeys(BOOK_VISIBILITY_NOTICE_KIND, memberIds.map((memberId) => ({ memberId }))),
  ]);

  const sendTo = async (memberId: string) => {
    if (told.get(memberId)?.has(BOOK_VISIBILITY_NOTICE_KEY)) return;
    const message = bookVisibilityNoticeMessage(counts.get(memberId) ?? 1);
    if (!live.has(memberId)) {
      const channels = notifier.channelsFor(memberId);
      if (channels.length > 0) result.dryRun++;
      console.log(
        "[book-visibility-notice] DRY RUN",
        JSON.stringify({ memberId, wouldSend: channels.length > 0, channels, books: counts.get(memberId) ?? 0, text: message.text, url: message.url ?? null }),
      );
      return;
    }
    // Opted out everywhere, or no address: no claim, so turning a channel on later still tells them.
    if (!notifier.canReach(memberId)) return;
    if (!(await repos.notificationLog.claim({ memberId }, BOOK_VISIBILITY_NOTICE_KIND, BOOK_VISIBILITY_NOTICE_KEY, now))) return;
    const delivered = await notifier.send(memberId, message);
    if (delivered.length > 0) result.sent++;
    // Only a message that went nowhere can retry; a partial success stays claimed (as for every notification).
    else await repos.notificationLog.release({ memberId }, BOOK_VISIBILITY_NOTICE_KIND, BOOK_VISIBILITY_NOTICE_KEY);
  };

  for (const batch of chunk(memberIds, BATCH)) await Promise.all(batch.map(sendTo));
  return result;
}
