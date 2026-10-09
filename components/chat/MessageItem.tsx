import Link from "next/link";
import ChatText, { type ChatTextContext } from "@/components/chat/ChatText";
import { formatChatTime } from "@/lib/chat/format";
import type { ChatMessageView } from "@/lib/chat/load";
import { slackEmojiToUnicode } from "@/lib/slack-emoji";

/** One message: author, time, text (or why there is none), reactions and a link into its thread. */
export default function MessageItem({
  message,
  ctx,
  channelId,
  inThread = false,
}: {
  message: ChatMessageView;
  ctx: ChatTextContext;
  channelId: string;
  inThread?: boolean;
}) {
  return (
    <article className="py-3 border-b border-slate-100 dark:border-slate-800 last:border-0" id={`m-${message.id}`}>
      <header className="flex items-baseline gap-2 text-sm">
        <span className="font-semibold">{message.authorName}</span>
        <time dateTime={message.createdAt} className="text-xs text-slate-500 dark:text-slate-400">
          {formatChatTime(message.createdAt)}
        </time>
        {message.editedAt && message.contentState === "ok" && <span className="text-xs text-slate-400">(edited)</span>}
      </header>

      {message.contentState === "ok" && message.body !== null && (
        <div className="mt-0.5 text-sm text-slate-800 dark:text-slate-200">
          <ChatText body={message.body} ctx={ctx} />
        </div>
      )}
      {message.contentState === "deleted" && (
        <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">This message was deleted.</p>
      )}
      {message.contentState === "hidden" && (
        <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">You can&apos;t read this message.</p>
      )}
      {message.hasFiles && message.contentState === "ok" && (
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">📎 Includes files, which the Hub doesn&apos;t show yet.</p>
      )}

      {message.reactions.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Reactions">
          {message.reactions.map((r) => (
            <li
              key={r.emoji}
              className={`px-2 py-0.5 rounded-full text-xs border ${
                r.mine
                  ? "border-plum-300 bg-plum-50 dark:border-plum-700 dark:bg-plum-900/20"
                  : "border-slate-200 dark:border-slate-700"
              }`}
              title={`:${r.emoji}:`}
            >
              {slackEmojiToUnicode(r.emoji.replace(/::skin-tone-\d$/, ""))} {r.count}
            </li>
          ))}
        </ul>
      )}

      {!inThread && message.replyCount > 0 && (
        <Link
          href={`/chat/${channelId}?thread=${message.id}`}
          className="mt-1.5 inline-block text-xs text-plum-600 dark:text-plum-400 hover:underline"
        >
          {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
          {message.lastReplyAt ? ` · last ${formatChatTime(message.lastReplyAt)}` : ""}
        </Link>
      )}
    </article>
  );
}
