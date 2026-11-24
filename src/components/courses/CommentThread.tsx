"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { deleteLessonComment, editLessonComment, postLessonComment, reportLessonComment, setLessonCommentFollow, suggestCommentMentions } from "@/app/(member)/courses/comment-actions";
import { track } from "@/lib/analytics/client";
import { COMMENT_EDIT_WINDOW_MS, COMMENT_MAX_LENGTH, REPORT_REASON_MAX_LENGTH, commentCountBucket, hasInstructorReply, involvesInstructor } from "@/lib/courses/comments";
import { FORMER_MEMBER_NAME, fullDate, mentionIds, namesToTokens, richParts, relativeAgo, spokenTimestamp, tokensToNames, type PickedMention } from "@/lib/courses/comment-text";
import type { MentionChoice } from "@/lib/courses/comment-mentions";
import { useComboboxKeys } from "@/lib/hooks/useComboboxKeys";
import { usePlayerSeek } from "@/components/courses/PlayerTime";
import type { ThreadComment, ThreadEntry } from "@/lib/data/course-comments";
import { MemberAvatarLink, MemberNameLink } from "@/components/member/MemberAvatarLink";
import Tooltip from "@/components/Tooltip";
import MemberHoverCard from "@/components/member/MemberHoverCard";

/**
 * The comments under a lesson (docs/product/COURSES.md, "Lesson comments"): a composer, the questions newest first and each one's
 * replies oldest first. Comments are plain text rendered as text; only http(s) addresses become links. The page passes what the
 * server read; every change goes through the server actions and then refreshes the page.
 */

interface Props {
  lessonId: string;
  courseId: string;
  entries: ThreadEntry[];
  /** Live comments in the thread (removed ones left out). */
  count: number;
  /** The member follows this lesson's thread: they hear about new comments in the daily note and about instructors' replies. */
  following: boolean;
  /** Comments by others since the member last opened the thread (0 on a first visit). */
  unread: number;
  /** The member the page is for: their own comments get edit and delete. */
  currentMemberId: string;
  /** The viewer is staff acting as themselves, so what they post carries the Instructor badge. */
  isStaff: boolean;
  /** Sudo: the thread shows, but nothing can be posted. */
  readOnly: boolean;
  /** The lesson has a video that is ready, so a typed timestamp (2:35) is a button that moves it. */
  canSeek?: boolean;
  /** Display names of the people mentioned in the thread's comments (id to name); a mention not in it reads "@someone". */
  mentionNames?: Record<string, string>;
  /** The viewer's IANA time zone. */
  timeZone: string;
  /** When the page was made, in milliseconds: relative dates and the edit window are measured from it so server and browser agree. */
  nowMs: number;
}

const buttonClass =
  "rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:cursor-not-allowed disabled:opacity-50";
const primaryButton = `${buttonClass} bg-plum-600 text-white hover:bg-plum-700`;
const highlightClass = "-m-2 rounded-lg bg-plum-50 p-2 ring-2 ring-plum-300 dark:bg-plum-950 dark:ring-plum-700";
/** A comment by an instructor or staff reads on a soft plum ground (slate text on plum-50 and on plum-950 both clear 4.5:1). */
const staffTint = "rounded-lg bg-plum-50 px-3 py-2 dark:bg-plum-950/50";
/** A question an instructor replied to carries a thin plum edge, so it stands out when skimming. */
const repliedEdge = "border-l-2 border-plum-400 pl-3 dark:border-plum-500";
const quietButton = `${buttonClass} text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800`;

interface ComposerProps {
  label: string;
  submitLabel: string;
  initial?: string;
  disabled?: boolean;
  disabledReason?: string;
  busy: boolean;
  error: string | null;
  autoFocus?: boolean;
  onSubmit: (text: string) => void;
  onCancel?: () => void;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /** Cleared by the parent after a successful post (it changes `resetKey`). */
  resetKey?: number;
  /** Typing `@name` offers the people in this lesson's course; absent, `@` is just a character. */
  lessonId?: string;
  /** Names for the mentions already in `initial`. */
  mentionNames?: Record<string, string>;
}

const NO_NAMES: Record<string, string> = {};

/** The `@name` being typed just before the caret: where it starts and what follows the `@`. */
function mentionTrigger(value: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[\s(])@([^\s@[\]][^@[\]\n]{0,39})$/.exec(value.slice(0, caret));
  return match ? { start: caret - match[1].length - 1, query: match[1] } : null;
}

function Composer({ label, submitLabel, initial = "", disabled, disabledReason, busy, error, autoFocus, onSubmit, onCancel, textareaRef, resetKey, lessonId, mentionNames }: ComposerProps) {
  const id = useId();
  const seed = useMemo(() => tokensToNames(initial, mentionNames ?? NO_NAMES), [initial, mentionNames]);
  const [text, setText] = useState(seed.text);
  // The people picked from the list: `@Name` in the box stands for them, and becomes their token when the comment is sent.
  const [picked, setPicked] = useState<PickedMention[]>(seed.picked);
  const [trigger, setTrigger] = useState<{ start: number; query: string } | null>(null);
  const [choices, setChoices] = useState<MentionChoice[]>([]);
  const open = Boolean(trigger) && choices.length > 0;
  const length = namesToTokens(text, picked).trim().length;
  const over = length > COMMENT_MAX_LENGTH;
  const near = length >= COMMENT_MAX_LENGTH - 200;

  useEffect(() => {
    if (resetKey === undefined) return;
    setText(seed.text);
    setPicked(seed.picked);
    // Only when the parent asks (after a post): a refresh that brings new names must not wipe what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // What is typed after the `@` is looked up a moment after the last key, and only the latest answer is kept.
  const query = trigger?.query;
  useEffect(() => {
    if (!lessonId || !query) return;
    let current = true;
    const timer = setTimeout(() => {
      suggestCommentMentions(lessonId, query)
        .then((found) => current && setChoices(found))
        .catch(() => current && setChoices([]));
    }, 150);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [lessonId, query]);

  function pick(index: number) {
    const choice = choices[index];
    if (!choice || !trigger) return;
    const end = trigger.start + 1 + trigger.query.length;
    const inserted = `@${choice.name} `;
    setText(text.slice(0, trigger.start) + inserted + text.slice(end));
    setPicked((previous) => [...previous, { memberId: choice.memberId, name: choice.name }]);
    setTrigger(null);
    setChoices([]);
    const caret = trigger.start + inserted.length;
    setTimeout(() => {
      const box = document.getElementById(id) as HTMLTextAreaElement | null;
      box?.focus();
      box?.setSelectionRange(caret, caret);
    }, 0);
  }

  const combo = useComboboxKeys({
    count: open ? choices.length : 0,
    options: choices,
    onPick: pick,
    onEscape: () => {
      if (!trigger) return false;
      setTrigger(null);
      return true;
    },
    preselect: true,
    pickOnTab: true,
  });

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && !busy) onSubmit(namesToTokens(text, picked));
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <textarea
        id={id}
        ref={textareaRef}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setTrigger(lessonId && !disabled ? mentionTrigger(event.target.value, event.target.selectionStart) : null);
        }}
        {...(lessonId ? combo.inputProps(open) : {})}
        rows={3}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-describedby={`${id}-count ${id}-error`}
        aria-invalid={over || undefined}
        placeholder={disabled ? disabledReason : undefined}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 disabled:bg-slate-100 dark:border-slate-700 dark:bg-slate-950 dark:disabled:bg-slate-800"
      />
      {open && (
        <ul {...combo.listboxProps} aria-label="People you can mention" className="mt-1 max-h-48 overflow-auto rounded-lg border border-slate-300 bg-white p-1 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-950">
          {choices.map((choice, index) => (
            <li
              key={choice.memberId}
              {...combo.optionProps(index)}
              onClick={() => pick(index)}
              className={`flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 ${index === combo.activeIndex ? "bg-plum-100 dark:bg-plum-900" : ""}`}
            >
              <span>{choice.name}</span>
              {choice.isInstructor && <span className="rounded-full bg-plum-100 px-2 py-0.5 text-xs font-medium text-plum-800 dark:bg-plum-900 dark:text-plum-100">Instructor</span>}
            </li>
          ))}
        </ul>
      )}
      <p className="sr-only" aria-live="polite">
        {open ? `${choices.length} ${choices.length === 1 ? "person" : "people"} to mention. Use the up and down arrow keys, then Enter.` : ""}
      </p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p id={`${id}-count`} aria-live="polite" className={`text-xs ${over ? "text-red-700 dark:text-red-400" : "text-slate-600 dark:text-slate-400"}`}>
          {/* Said only near the limit, so a screen reader isn't told the count at every keystroke. */}
          {near ? `${length.toLocaleString("en-US")} of ${COMMENT_MAX_LENGTH.toLocaleString("en-US")} characters` : ""}
        </p>
        <div className="flex gap-2">
          {onCancel && (
            <button type="button" onClick={onCancel} className={quietButton}>
              Cancel
            </button>
          )}
          <button type="submit" disabled={disabled || busy || length === 0 || over} data-track="lesson-comment-submit" className={primaryButton}>
            {busy ? "Posting…" : submitLabel}
          </button>
        </div>
      </div>
      <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
        {error}
      </p>
    </form>
  );
}

function Body({ text, onSeek, mentionNames }: { text: string; onSeek?: (seconds: number) => void; mentionNames?: Record<string, string> }) {
  return (
    <p className="mt-1 whitespace-pre-wrap break-words text-sm">
      {richParts(text).map((part, index) => {
        if (part.type === "link") {
          return (
            <a key={index} href={part.value} rel="nofollow noopener noreferrer" target="_blank" className="text-plum-700 underline dark:text-plum-300">
              {part.value}
            </a>
          );
        }
        if (part.type === "mention") {
          const mentionName = mentionNames?.[part.memberId];
          // Only a person who can be named gets the card; "@someone" stays plain text.
          return mentionName ? (
            <MemberHoverCard key={index} memberId={part.memberId} surface="lesson_comments">
              <Link href={`/members/${part.memberId}`} data-track="lesson-comment-mention" className="font-medium text-plum-700 dark:text-plum-300">
                @{mentionName}
              </Link>
            </MemberHoverCard>
          ) : (
            <span key={index} className="font-medium text-plum-700 dark:text-plum-300">
              @someone
            </span>
          );
        }
        if (part.type === "time" && onSeek) {
          return (
            <button
              key={index}
              type="button"
              onClick={() => onSeek(part.seconds)}
              aria-label={`Play the video from ${spokenTimestamp(part.seconds)}`}
              data-track="lesson-comment-timestamp"
              className="rounded px-0.5 font-medium text-plum-700 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:text-plum-300"
            >
              {part.value}
            </button>
          );
        }
        return <span key={index}>{part.value}</span>;
      })}
    </p>
  );
}

interface ReportFormProps {
  busy: boolean;
  error: string | null;
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}

/** A short reason for a report. The reporter's name never reaches the comment's author. */
function ReportForm({ busy, error, onSubmit, onCancel }: ReportFormProps) {
  const id = useId();
  const [reason, setReason] = useState("");
  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) onSubmit(reason);
      }}
    >
      <label htmlFor={id} className="block text-sm font-medium">
        What's wrong with this comment?
      </label>
      <textarea
        id={id}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        rows={2}
        maxLength={REPORT_REASON_MAX_LENGTH}
        autoFocus
        aria-describedby={`${id}-error`}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-plum-500 dark:border-slate-700 dark:bg-slate-950"
      />
      <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Only our staff see your report. The person who wrote the comment isn't told.</p>
      <div className="mt-2 flex gap-2">
        <button type="submit" disabled={busy || reason.trim().length === 0} data-track="lesson-comment-report-submit" className={primaryButton}>
          {busy ? "Sending…" : "Send report"}
        </button>
        <button type="button" onClick={onCancel} className={quietButton}>
          Cancel
        </button>
      </div>
      <p id={`${id}-error`} role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
        {error}
      </p>
    </form>
  );
}

interface ItemProps {
  comment: ThreadComment;
  isReply: boolean;
  props: Props;
  /** Opens a reply box under the question. */
  onReply: () => void;
  onChanged: (message: string) => void;
  /** Moves the lesson's video; absent when there is none to move. */
  onSeek?: (seconds: number) => void;
  /** An instructor replied under this question: it gets the edge and the label. */
  instructorReplied?: boolean;
}

function CommentItem({ comment, isReply, props, onReply, onChanged, onSeek, instructorReplied }: ItemProps) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reported, setReported] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (comment.removed) {
    return (
      <p className="text-sm italic text-slate-600 dark:text-slate-400">Comment removed</p>
    );
  }

  const mine = comment.memberId === props.currentMemberId;
  const canEdit = mine && !props.readOnly && props.nowMs - new Date(comment.createdAt).getTime() <= COMMENT_EDIT_WINDOW_MS;
  const canDelete = mine && !props.readOnly;
  // Not your own, not while previewing, not for staff (who hide from the moderation queue), not for something staff are still reviewing.
  const canReport = !mine && !props.readOnly && !props.isStaff && !comment.held && !comment.hidden;

  function save(text: string) {
    setError(null);
    startTransition(async () => {
      const result = await editLessonComment(comment.id, text);
      if (result.error) return setError(result.error);
      track("lesson_comment_edited", { course_id: props.courseId });
      setEditing(false);
      onChanged("Comment updated");
    });
  }

  function sendReport(reason: string) {
    setError(null);
    startTransition(async () => {
      const result = await reportLessonComment(comment.id, reason);
      if (result.error) return setError(result.error);
      track("lesson_comment_reported", { course_id: props.courseId, is_reply: isReply });
      setReporting(false);
      setReported(true);
      onChanged("Report sent. Thank you.");
    });
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await deleteLessonComment(comment.id);
      if (result.error) return setError(result.error);
      track("lesson_comment_deleted", { course_id: props.courseId, is_reply: isReply });
      onChanged("Comment deleted");
    });
  }

  const staffComment = comment.isStaffReply && !comment.hidden && !comment.held;
  // An author who can't be named has no profile to open: no link and no card.
  const authorId = comment.authorName === FORMER_MEMBER_NAME ? null : comment.memberId;
  const profileHref = `/members/${comment.memberId}`;
  return (
    <div data-staff={staffComment || undefined} data-instructor-replied={instructorReplied || undefined} className={[staffComment ? staffTint : "", instructorReplied ? repliedEdge : ""].filter(Boolean).join(" ") || undefined}>
      <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="self-center">
          <MemberAvatarLink memberId={authorId} name={comment.authorName} photoUrl={comment.authorPhotoUrl ?? null} size={isReply ? 24 : 32} surface="lesson_comments" href={profileHref} trackName="lesson-comment-avatar" />
        </span>
        <MemberNameLink memberId={authorId} name={comment.authorName} surface="lesson_comments" href={profileHref} trackName="lesson-comment-author" />
        {comment.isStaffReply && (
          <span className="rounded-full bg-plum-100 px-2 py-0.5 text-xs font-medium text-plum-800 dark:bg-plum-900 dark:text-plum-100">Instructor</span>
        )}
        <Tooltip content={fullDate(comment.createdAt, props.timeZone)}>
          <time dateTime={comment.createdAt} className="text-xs text-slate-600 dark:text-slate-400">
            {relativeAgo(comment.createdAt, props.nowMs, props.timeZone)}
          </time>
        </Tooltip>
        {comment.editedAt && <span className="text-xs text-slate-600 dark:text-slate-400">edited</span>}
        {instructorReplied && <span className="text-xs font-medium text-plum-700 dark:text-plum-300">Instructor replied</span>}
        {comment.held && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-950 dark:text-amber-200">Held for review</span>
        )}
        {comment.hidden && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">Hidden from members</span>
        )}
      </p>
      {comment.held && (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {mine ? "Only you and our staff can see this until it's reviewed. Comments with more than two links wait for a quick check." : "Held for review: not shown to members yet."}
        </p>
      )}

      {editing ? (
        <div className="mt-2">
          <Composer label="Edit your comment" submitLabel="Save" initial={comment.body ?? ""} lessonId={props.lessonId} mentionNames={props.mentionNames} busy={pending} error={error} autoFocus onSubmit={save} onCancel={() => setEditing(false)} />
        </div>
      ) : (
        <Body text={comment.body ?? ""} onSeek={onSeek} mentionNames={props.mentionNames} />
      )}

      {!editing && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {!comment.held && (
            <button type="button" onClick={onReply} disabled={props.readOnly} className={quietButton} data-track="lesson-comment-reply">
              Reply
            </button>
          )}
          {canReport &&
            (reported ? (
              <span className="px-3 py-1.5 text-sm text-slate-600 dark:text-slate-400">Reported</span>
            ) : (
              <button type="button" onClick={() => setReporting(true)} aria-expanded={reporting} className={quietButton} data-track="lesson-comment-report">
                Report
              </button>
            ))}
          {canEdit && (
            <button type="button" onClick={() => setEditing(true)} className={quietButton} data-track="lesson-comment-edit">
              Edit
            </button>
          )}
          {canDelete &&
            (confirming ? (
              <>
                <button type="button" onClick={remove} disabled={pending} className={`${buttonClass} text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950`}>
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirming(false)} className={quietButton}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setConfirming(true)} className={quietButton} data-track="lesson-comment-delete">
                Delete
              </button>
            ))}
        </div>
      )}
      {reporting && <ReportForm busy={pending} error={error} onSubmit={sendReport} onCancel={() => { setReporting(false); setError(null); }} />}
      {!editing && !reporting && error && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export default function CommentThread(props: Props) {
  const router = useRouter();
  const headingId = useId();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [replyError, setReplyError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [resetKey, setResetKey] = useState(0);
  const [pending, startTransition] = useTransition();
  const [following, setFollowing] = useState(props.following);
  const [followError, setFollowError] = useState<string | null>(null);
  // "Instructor answers" keeps the questions an instructor is in; everyone's list is the default.
  const [onlyInstructor, setOnlyInstructor] = useState(false);
  const seekVideo = usePlayerSeek();
  const hasInstructor = props.entries.some(involvesInstructor);
  const shown = onlyInstructor ? props.entries.filter(involvesInstructor) : props.entries;

  function seek(seconds: number) {
    seekVideo(seconds);
    setAnnouncement(`Playing the video from ${spokenTimestamp(seconds)}`);
  }
  // A link from a notification names the comment (?comment=cmnt_...): scroll to it and mark it.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => setFollowing(props.following), [props.following]);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("comment");
    const target = id ? document.getElementById(id) : null;
    if (!id || !target) return;
    setHighlightId(id);
    target.scrollIntoView({ block: "center" });
  }, [props.lessonId, props.entries]);

  function toggleFollow() {
    const next = !following;
    setFollowError(null);
    startTransition(async () => {
      const result = await setLessonCommentFollow(props.lessonId, next);
      if (result.error) return setFollowError(result.error);
      setFollowing(next);
      track("lesson_follow_toggled", { course_id: props.courseId, following: next });
      setAnnouncement(next ? "You follow this lesson's comments" : "You no longer follow this lesson's comments");
    });
  }

  useEffect(() => {
    track("lesson_comments_viewed", { course_id: props.courseId, count_bucket: commentCountBucket(props.count) });
    // Once per lesson page, not at every change to the thread.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.lessonId]);

  function post(text: string, parentId: string | null) {
    const setFailure = parentId ? setReplyError : setError;
    setFailure(null);
    startTransition(async () => {
      const result = await postLessonComment(props.lessonId, text, parentId);
      if (result.error) return setFailure(result.error);
      track("lesson_comment_posted", { course_id: props.courseId, is_reply: parentId !== null, is_staff: props.isStaff, has_mention: mentionIds(text).length > 0 });
      setAnnouncement(result.held ? "Posted. It will show to others once staff have looked at it." : parentId ? "Reply posted" : "Comment posted");
      setResetKey((key) => key + 1);
      setReplyingTo(null);
      router.refresh();
      // The new comment appears when the page refreshes; the writer goes back to the box to carry on.
      composerRef.current?.focus();
    });
  }

  function changed(message: string) {
    setAnnouncement(message);
    router.refresh();
  }

  const replyBox = (parentId: string) =>
    replyingTo === parentId && (
      <div className="mt-3">
        <Composer
          label="Your reply"
          submitLabel="Reply"
          lessonId={props.lessonId}
          mentionNames={props.mentionNames}
          busy={pending}
          error={replyError}
          autoFocus
          onSubmit={(text) => post(text, parentId)}
          onCancel={() => {
            setReplyingTo(null);
            setReplyError(null);
          }}
        />
      </div>
    );

  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id={headingId} className="text-lg font-semibold">
          Comments ({props.count})
          {props.unread > 0 && <span className="ml-2 text-sm font-normal text-plum-700 dark:text-plum-300">{props.unread} new since your last visit</span>}
        </h2>
        {!props.readOnly && (
          <button type="button" onClick={toggleFollow} disabled={pending} aria-pressed={following} className={quietButton} data-track="lesson-comments-follow">
            {following ? "Following" : "Follow"}
          </button>
        )}
      </div>
      {followError && (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {followError}
        </p>
      )}
      {!props.readOnly && (
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {following ? "You'll hear about instructors' replies here and new comments in a daily note." : "Follow to hear about instructors' replies here and new comments in a daily note."}
        </p>
      )}

      <div className="mt-4">
        <Composer
          label="Ask a question or leave a comment"
          submitLabel="Post comment"
          lessonId={props.lessonId}
          mentionNames={props.mentionNames}
          disabled={props.readOnly}
          disabledReason="Read-only while previewing"
          busy={pending && replyingTo === null}
          error={error}
          textareaRef={composerRef}
          resetKey={resetKey}
          onSubmit={(text) => post(text, null)}
        />
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          {props.readOnly ? "Read-only while previewing. " : ""}Comments are visible to members of this course and our staff.
        </p>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {hasInstructor && (
        <div role="group" aria-label="Show" className="mt-6 flex flex-wrap gap-2">
          <button type="button" aria-pressed={!onlyInstructor} onClick={() => setOnlyInstructor(false)} className={`${quietButton} ${!onlyInstructor ? "bg-slate-100 dark:bg-slate-800" : ""}`} data-track="lesson-comments-filter-all">
            All comments
          </button>
          <button type="button" aria-pressed={onlyInstructor} onClick={() => setOnlyInstructor(true)} className={`${quietButton} ${onlyInstructor ? "bg-slate-100 dark:bg-slate-800" : ""}`} data-track="lesson-comments-filter-instructor">
            Instructor answers
          </button>
        </div>
      )}

      {props.entries.length === 0 ? (
        <p className="mt-6 text-sm text-slate-600 dark:text-slate-400">No questions yet. Stuck on something in this lesson? Ask here.</p>
      ) : (
        <ul className="mt-6 space-y-6">
          {shown.map((entry) => (
            <li key={entry.comment.id} id={entry.comment.id} className={highlightId === entry.comment.id ? highlightClass : undefined}>
              <CommentItem comment={entry.comment} isReply={false} props={props} onReply={() => setReplyingTo(entry.comment.id)} onChanged={changed} onSeek={props.canSeek ? seek : undefined} instructorReplied={hasInstructorReply(entry)} />
              {(entry.replies.length > 0 || replyingTo === entry.comment.id) && (
                <div className="mt-3 border-l-2 border-slate-200 pl-4 dark:border-slate-700">
                  <ul className="space-y-4">
                    {entry.replies.map((reply) => (
                      <li key={reply.id} id={reply.id} className={highlightId === reply.id ? highlightClass : undefined}>
                        <CommentItem comment={reply} isReply props={props} onReply={() => setReplyingTo(entry.comment.id)} onChanged={changed} onSeek={props.canSeek ? seek : undefined} />
                      </li>
                    ))}
                  </ul>
                  {replyBox(entry.comment.id)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
