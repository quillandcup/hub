import Link from "next/link";
import RemoveUnfurlButton from "@/components/chat/RemoveUnfurlButton";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { formatChatTime } from "@/lib/chat/format";
import type { SharedMessage, SharedMessageSource } from "@/lib/chat/shared-message";

const cardClass = "group relative mt-1 max-w-xl rounded-md border-l-4 border-mist-300 bg-gray-50 px-3 py-2 text-sm";

/**
 * A Slack message quoted inside another message. It shows Slack's embedded copy to everyone who can read the sharing
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
  return (
    <div className={cardClass} data-testid="shared-message-card">
      <div className="flex items-center gap-2">
        <MemberAvatar name={shared.authorName} photoUrl={shared.authorIcon} size={20} />
        <span className="font-semibold text-gray-900">{shared.authorName}</span>
        {shared.authorSubname && <span className="text-xs text-gray-500">{shared.authorSubname}</span>}
        {shared.postedAt && <time dateTime={shared.postedAt} className="text-xs text-gray-500">{formatChatTime(shared.postedAt, timeZone)}</time>}
      </div>
      {(shared.channelName || shared.footer) && (
        <p className="mt-0.5 text-xs text-gray-500">
          {shared.channelName ? `Posted in #${shared.channelName}` : <ChatText body={shared.footer ?? ""} ctx={ctx} />}
        </p>
      )}
      {shared.text.trim() && (
        <div className="mt-1 text-gray-800">
          <ChatText body={shared.text} ctx={ctx} />
        </div>
      )}
      {shared.files.length > 0 && (
        <p className="mt-1 text-xs text-gray-500">
          {shared.files.length === 1 ? `Attached: ${shared.files[0].name}` : `${shared.files.length} files attached`}
        </p>
      )}
      {source.deleted && <p className="mt-1 text-xs italic text-gray-500">The original message was deleted.</p>}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
        {source.hubUrl ? (
          <Link href={source.hubUrl} className="text-mist-700 underline">
            View in Chat
          </Link>
        ) : (
          shared.slackUrl && (
            <a href={shared.slackUrl} target="_blank" rel="noopener noreferrer" className="text-mist-700 underline">
              Open in Slack
            </a>
          )
        )}
      </div>
      {removable && <RemoveUnfurlButton channelId={removable.channelId} messageId={removable.messageId} removeKey={removable.removeKey} source="slack" />}
    </div>
  );
}
