import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { formatChatTime } from "@/lib/chat/format";
import type { SharedMessage, SharedMessageSource } from "@/lib/chat/shared-message";

const cardClass = "mt-1 max-w-xl rounded-md border-l-4 border-mist-300 bg-gray-50 px-3 py-2 text-sm";

/**
 * A Slack message quoted inside another message. The text, author and channel appear only when `source` says the viewer
 * can read the original (`sharedMessageSource`); otherwise a stub that names nothing, so a private conversation's
 * content never reaches someone who can't read it just because it was shared into a place they can.
 */
export default function SharedMessageCard({ shared, source, ctx }: { shared: SharedMessage; source: SharedMessageSource; ctx: ChatTextContext }) {
  if (source.kind !== "readable") {
    return (
      <div className={cardClass} data-testid="shared-message-stub">
        <p className="text-gray-600">{source.kind === "private" ? "A message from a private conversation." : "A message from another Slack conversation."}</p>
        {source.kind === "elsewhere" && shared.slackUrl && (
          <a href={shared.slackUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-mist-700 underline">
            Open in Slack
          </a>
        )}
      </div>
    );
  }

  return (
    <div className={cardClass} data-testid="shared-message-card">
      <div className="flex items-center gap-2">
        <MemberAvatar name={shared.authorName} photoUrl={shared.authorIcon} size={20} />
        <span className="font-semibold text-gray-900">{shared.authorName}</span>
        {shared.authorSubname && <span className="text-xs text-gray-500">{shared.authorSubname}</span>}
        {shared.postedAt && <time dateTime={shared.postedAt} className="text-xs text-gray-500">{formatChatTime(shared.postedAt)}</time>}
      </div>
      {source.deleted ? (
        <p className="mt-1 italic text-gray-500">This message was deleted.</p>
      ) : (
        <div className="mt-1 text-gray-800">
          <ChatText body={source.text} ctx={ctx} />
        </div>
      )}
      {shared.files.length > 0 && !source.deleted && (
        <p className="mt-1 text-xs text-gray-500">
          {shared.files.length === 1 ? `Attached: ${shared.files[0].name}` : `${shared.files.length} files attached`}
        </p>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-gray-500">
        {shared.channelName && <span>Posted in #{shared.channelName}</span>}
        <Link href={source.hubUrl} className="text-mist-700 underline">
          View in Chat
        </Link>
      </div>
    </div>
  );
}
