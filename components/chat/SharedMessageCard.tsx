import Link from "next/link";
import CardClickArea from "@/components/chat/CardClickArea";
import RemoveUnfurlButton from "@/components/chat/RemoveUnfurlButton";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { formatChatTime } from "@/lib/chat/format";
import type { SharedMessage, SharedMessageSource } from "@/lib/chat/shared-message";

const cardClass = "group relative mt-1 max-w-xl rounded-md border border-l-4 border-mist-300 bg-slate-50 px-3 dark:border-mist-700 dark:bg-slate-800/40 py-2 text-sm";
/** The one link of the card, stretched over its whole box (its ::after), so there is no link inside a link. Content that must stay usable sits above it (z-10). */
const stretched = "after:absolute after:inset-0 after:rounded-md after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-plum-600 dark:focus-visible:after:ring-plum-400";
const linkClass = "text-plum-600 underline dark:text-plum-400";

/**
 * A Slack message quoted inside another message, as one box that is a link to the original (stretched link: the "View in Chat" / "Open in Slack" anchor's ::after covers it; text and the X sit above it). It shows Slack's embedded copy to everyone who can read the sharing
 * message (the sharer chose to share it; see docs/SLACK_BRIDGED_CHAT.md, "Shared Slack messages"). `source` only adds
 * a link to the original in the Hub when the viewer can open it, and a note when it was deleted there.
 */
export default function SharedMessageCard({
  shared,
  source,
  ctx,
  timeZone,
  removable,
}: {
  shared: SharedMessage;
  source: SharedMessageSource;
  ctx: ChatTextContext;
  /** The viewer's zone, the one the message rows use, so the card and the row beside it agree. */
  timeZone?: string;
  /** Set only for the sharing message's author (and not in sudo): the X that removes the card. */
  removable?: { channelId: string; messageId: string; removeKey: string };
}) {
  // The whole card is one link when there is somewhere to go: the Hub copy, else Slack's. A deleted original has nowhere to go.
  const clickable = !source.deleted && (!!source.hubUrl || !!shared.slackUrl);
  const hover = clickable ? " hover:border-mist-500 hover:bg-slate-100 dark:hover:border-mist-500 dark:hover:bg-slate-800/70" : "";
  return (
    <div className={cardClass + hover} data-testid="shared-message-card" data-stretched-card={clickable ? "" : undefined}>
      <CardClickArea className={clickable ? "relative z-10" : undefined}>
        <div className="flex items-center gap-2">
          <MemberAvatar name={shared.authorName} photoUrl={shared.authorIcon} size={20} />
          <span className="font-semibold text-slate-900 dark:text-slate-100">{shared.authorName}</span>
          {shared.authorSubname && <span className="text-xs text-slate-600 dark:text-slate-400">{shared.authorSubname}</span>}
          {shared.postedAt && <time dateTime={shared.postedAt} className="text-xs text-slate-600 dark:text-slate-400">{formatChatTime(shared.postedAt, timeZone)}</time>}
        </div>
        {shared.channelName && <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{`Posted in #${shared.channelName}`}</p>}
        {shared.text.trim() && (
          <div className="mt-1 text-slate-800 dark:text-slate-100">
            <ChatText body={shared.text} ctx={ctx} />
          </div>
        )}
        {shared.files.length > 0 && (
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
            {shared.files.length === 1 ? `Attached: ${shared.files[0].name}` : `${shared.files.length} files attached`}
          </p>
        )}
        {source.deleted && <p className="mt-1 text-xs italic text-slate-600 dark:text-slate-400">The original message was deleted.</p>}
      </CardClickArea>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-slate-600 dark:text-slate-400">
        {source.hubUrl ? (
          <Link href={source.hubUrl} data-stretched-link={clickable ? "" : undefined} className={linkClass + (clickable ? " " + stretched : "")}>
            View in Chat
          </Link>
        ) : (
          shared.slackUrl && (
            <a href={shared.slackUrl} target="_blank" rel="noopener noreferrer" data-stretched-link={clickable ? "" : undefined} className={linkClass + (clickable ? " " + stretched : "")}>
              Open in Slack
            </a>
          )
        )}
      </div>
      {removable && <RemoveUnfurlButton channelId={removable.channelId} messageId={removable.messageId} removeKey={removable.removeKey} source="slack" placement="gutter" />}
    </div>
  );
}
