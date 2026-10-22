import Link from "next/link";
import MemberAvatar from "@/app/(member)/members/[id]/MemberAvatar";
import MemberHoverCard from "@/components/member/MemberHoverCard";
import AvatarStack from "@/components/AvatarStack";
import { type ChatTextContext } from "@/components/chat/ChatText";
import MessageActions from "@/components/chat/MessageActions";
import MessageBody from "@/components/chat/MessageBody";
import MessageFiles from "@/components/chat/MessageFiles";
import ReactionBar from "@/components/chat/ReactionBar";
import RetryButton from "@/components/chat/RetryButton";
import { formatChatClock, formatChatTime } from "@/lib/chat/format";
import { isPendingId } from "@/lib/chat/list-events";
import type { ChatMessageView } from "@/lib/chat/load";
import { decodeEntities, mentionsToPlainText } from "@/lib/chat/render";

/** Slack's own wording for a channel notice: "Ania renamed the channel…", a plain name rather than a mention chip. */
function systemNoticeText(body: string, ctx: ChatTextContext): string {
  return decodeEntities(mentionsToPlainText(body, ctx))
    .replace(/^@/, "")
    .replace(/^(.+?) has (renamed|set|archived|unarchived|changed)\b/, "$1 $2");
}

/** One message: author, time, text (or why there is none), reactions and a link into its thread. */
export default function MessageItem({
  message,
  ctx,
  channelId,
  inThread = false,
  canReact = false,
  canEdit = false,
  compact = false,
  timeZone,
}: {
  message: ChatMessageView;
  ctx: ChatTextContext;
  channelId: string;
  inThread?: boolean;
  /** Show the add-reaction controls and make the chips toggles. */
  canReact?: boolean;
  /** Let the author edit and delete their own Hub messages (the same gate as reacting). */
  canEdit?: boolean;
  /** A follow-up from the same person right after the previous message: no avatar, name or time (the time shows on hover). */
  compact?: boolean;
  /** The reader's time zone, for every time shown. */
  timeZone?: string;
}) {
  const profileHref = `/chat/${channelId}?profile=${message.authorMemberId}`;
  const sent = !isPendingId(message.id);
  const reactable = canReact && message.contentState === "ok" && sent;
  const clock = formatChatClock(message.createdAt, timeZone);
  if (message.system && message.contentState === "ok" && message.body !== null) {
    return (
      <article className="py-1.5 flex items-baseline gap-3" id={`m-${message.id}`}>
        <span aria-hidden="true" className="shrink-0 w-9 text-center text-lg font-semibold leading-none text-slate-400 dark:text-slate-500">
          #
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-slate-500 dark:text-slate-400">
            {systemNoticeText(message.body, ctx)}{" "}
            <time dateTime={message.createdAt} className="text-xs text-slate-400 dark:text-slate-500">
              {formatChatTime(message.createdAt, timeZone)}
            </time>
          </p>
          <ReactionBar channelId={channelId} messageId={message.id} reactions={message.reactions} custom={ctx.customEmoji} canReact={canReact && !isPendingId(message.id)} />
        </div>
      </article>
    );
  }
  return (
    <article
      className={`group relative -mx-2 flex gap-3 rounded-md px-2 hover:bg-slate-50 focus-within:bg-slate-50 dark:hover:bg-slate-800/50 dark:focus-within:bg-slate-800/50 ${
        compact ? "py-0.5" : "pb-1 pt-2"
      }`}
      id={`m-${message.id}`}
    >
      <div className="w-9 shrink-0 pt-0.5">
        {compact ? (
          <time
            dateTime={message.createdAt}
            title={formatChatTime(message.createdAt, timeZone)}
            className="invisible block whitespace-nowrap pt-0.5 text-right text-[10px] leading-5 text-slate-500 group-hover:visible group-focus-within:visible dark:text-slate-400"
          >
            {clock.replace(/\s?[AP]M$/i, "")}
          </time>
        ) : message.authorMemberId ? (
          <Link data-track="chat-message-avatar" href={profileHref} scroll={false} aria-hidden="true" tabIndex={-1}>
            <MemberAvatar name={message.authorName} photoUrl={message.authorPhotoUrl} size={36} />
          </Link>
        ) : (
          <span aria-hidden="true">
            <MemberAvatar name={message.authorName} photoUrl={message.authorPhotoUrl} size={36} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        {!compact && (
          <header className="flex items-baseline gap-2 text-sm">
            {message.authorMemberId ? (
              <MemberHoverCard memberId={message.authorMemberId} surface="chat">
                <Link href={profileHref} scroll={false} data-track="chat-message-author" className="font-semibold hover:underline">
                  {message.authorName}
                </Link>
              </MemberHoverCard>
            ) : (
              <span className="font-semibold">{message.authorName}</span>
            )}
            <time dateTime={message.createdAt} className="text-xs text-slate-500 dark:text-slate-400">
              {clock}
            </time>
            {message.editedAt && message.contentState === "ok" && <span className="text-xs text-slate-400">(edited)</span>}
          </header>
        )}
        {compact && message.editedAt && message.contentState === "ok" && <span className="sr-only">(edited)</span>}

        {message.contentState === "ok" && message.body !== null && (
          <MessageBody message={{ ...message, body: message.body }} ctx={ctx} channelId={channelId} canEdit={canEdit} />
        )}
        {message.contentState === "deleted" && (
          <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">This message was deleted.</p>
        )}
        {message.contentState === "hidden" && (
          <p className="mt-0.5 text-sm italic text-slate-500 dark:text-slate-400">You can&apos;t read this message.</p>
        )}
        {message.syncStatus === "pending" && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sending to Slack…</p>
        )}
        {message.syncStatus === "failed" && (
          <p className="mt-1 text-xs text-red-600 dark:text-red-400">
            Slack didn&apos;t get this message.{" "}
            {message.mine && <RetryButton channelId={channelId} messageId={message.id} />}
          </p>
        )}
        {message.contentState === "ok" && <MessageFiles messageId={message.id} files={message.files} />}
        {message.hasFiles && message.contentState === "ok" && message.files.length === 0 && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">📎 Includes files the Hub couldn&apos;t load.</p>
        )}

        <ReactionBar channelId={channelId} messageId={message.id} reactions={message.reactions} custom={ctx.customEmoji} canReact={reactable} />

        {!inThread && message.replyCount > 0 && (
          <Link
            href={`/chat/${channelId}?thread=${message.id}`}
            data-track="chat-open-thread"
            scroll={false}
            className="mt-1.5 inline-flex items-center gap-2 text-xs text-plum-600 dark:text-plum-400 hover:underline"
          >
            <AvatarStack people={message.replyAuthors} size={20} />
            <span>
              {message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}
              {message.lastReplyAt ? ` · last ${formatChatTime(message.lastReplyAt, timeZone)}` : ""}
            </span>
          </Link>
        )}
      </div>
      {sent && message.contentState !== "deleted" && message.contentState !== "hidden" && (
        <MessageActions
          channelId={channelId}
          messageId={message.id}
          body={message.contentState === "ok" ? message.body : null}
          custom={ctx.customEmoji}
          canReact={reactable}
          canReply={!inThread}
        />
      )}
    </article>
  );
}
