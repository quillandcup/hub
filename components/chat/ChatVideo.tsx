"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import LessonPlayer from "@/components/courses/LessonPlayer";
import { LessonCompletionProvider, useLessonCompletion } from "@/components/courses/LessonCompletion";
import type { PlaybackTokens } from "@/lib/mux";

/** What the card shows before play, from GET /api/chat/videos/<message id>; `canWatch` null until it has answered (or when it couldn't). */
interface CardInfo {
  title: string | null;
  courseTitle: string | null;
  thumbnailUrl: string | null;
  canWatch: boolean | null;
}

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string; lessonId: string; lessonHref: string | null; playbackId: string; tokens: PlaybackTokens; restricted: boolean; record: boolean; resumeSeconds: number; completion: { completed: boolean } | null }
  | { kind: "error"; message: string };

/** Under the title of a video whose lesson the member has completed (by watching it through, here or on the lesson page): says so, and nothing otherwise. */
function CompleteNote() {
  const completion = useLessonCompletion();
  return (
    <div className="px-3 pb-2" role="status">
      {completion?.completed && <p className="text-xs text-slate-600 dark:text-slate-400">✓ Lesson complete</p>}
      {completion?.error && <p className="text-xs text-red-600 dark:text-red-400">{completion.error}</p>}
    </div>
  );
}

const NO_INFO: CardInfo = { title: null, courseTitle: null, thumbnailUrl: null, canWatch: null };

/**
 * A course lesson's video shared in a message. The card shows the lesson's thumbnail, title and course as soon as it appears (one light
 * request that mints nothing), and says up front when this viewer can't watch it (it is part of a course they don't have), so the click is
 * never a dead end. Pressing it asks /api/chat/videos/<message id> for playback links for this viewer (the server checks they can read the
 * message and may watch the video) and the course player takes over and starts playing: one click. What is watched is recorded like a
 * lesson view (resume included) but tagged with this message, so the staff watch stats keep chat views apart from the lesson's own. The
 * route says when not to record (sudo, a lesson not open to members).
 */
export default function ChatVideo({ messageId }: { messageId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  const [card, setCard] = useState<CardInfo>(NO_INFO);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/chat/videos/${messageId}`)
      .then(async (res) => (res.ok ? ((await res.json()) as Partial<CardInfo>) : null))
      .then((info) => {
        if (alive && info) setCard({ title: info.title ?? null, courseTitle: info.courseTitle ?? null, thumbnailUrl: info.thumbnailUrl ?? null, canWatch: typeof info.canWatch === "boolean" ? info.canWatch : null });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [messageId]);

  async function open() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/chat/videos/${messageId}`, { method: "POST" });
      if (res.status === 403) {
        setCard((c) => ({ ...c, canWatch: false }));
        setState({ kind: "idle" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: res.status === 429 ? "Too many videos opened just now. Try again in a few minutes." : "This video isn't available right now." });
        return;
      }
      const body = (await res.json()) as { title: string; lessonId: string; lessonHref?: string | null; playbackId: string; tokens: PlaybackTokens; restricted: boolean; record: boolean; resumeSeconds: number; completion?: { completed: boolean } | null };
      setState({ kind: "ready", ...body, lessonHref: body.lessonHref ?? null, completion: body.completion ?? null });
    } catch {
      setState({ kind: "error", message: "This video isn't available right now." });
    }
  }

  if (state.kind === "ready") {
    const media = (
          <LessonPlayer
            title={state.title}
            playbackId={state.playbackId}
            tokens={state.tokens}
            restricted={state.restricted}
            lessonId={state.lessonId}
            chatMessageId={messageId}
            resumeSeconds={state.resumeSeconds}
            trackProgress={state.record}
            autoPlay
            // The card's own thumbnail as the player's poster, so opening it doesn't swap to a different frame (Mux's, from two seconds in) before the video starts.
            posterUrl={card.thumbnailUrl && !imageFailed ? card.thumbnailUrl : null}
            overlay={
              state.lessonHref ? (
                // A new tab, so the conversation (and the video, still playing) stays where it is. Inside the player's skin, so it is drawn with the skin's own tokens like its fullscreen button (`.lesson-open-link`, app/globals.css).
                <Link href={state.lessonHref} target="_blank" rel="noopener noreferrer" data-track="chat-video-open-lesson" className="lesson-open-link">
                  <svg viewBox="0 0 24 24" className="lesson-open-link-icon" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M7 17 17 7M8 7h9v9" />
                  </svg>
                  <span className="lesson-open-link-label">Open lesson</span>
                </Link>
              ) : null
            }
          />
    );
    return (
      <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        {state.completion ? (
          // The same completion the lesson page keeps: the player completes the lesson once it is watched through (~90%).
          <LessonCompletionProvider lessonId={state.lessonId} initiallyCompleted={state.completion.completed} readOnlyReason={null}>
            {media}
            <p className="px-3 pt-2 text-sm font-medium text-slate-800 dark:text-slate-100">{state.title}</p>
            <CompleteNote />
          </LessonCompletionProvider>
        ) : (
          <>
            {media}
            <p className="px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100">{state.title}</p>
          </>
        )}
      </div>
    );
  }

  const title = card.title ?? "Lesson video";
  const subtitle = card.courseTitle ? `From ${card.courseTitle}` : "A lesson video from a course";

  // Not watchable by this viewer: say so on the card (no button to press), and what to do about it.
  if (card.canWatch === false) {
    return (
      <div className="mt-2 max-w-xl rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{card.title ?? "A lesson video"}</p>
        <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
          {card.courseTitle ? `Part of ${card.courseTitle}.` : "Part of a course."} You need access to the course to watch it.
        </p>
      </div>
    );
  }

  const busy = state.kind === "loading";
  return (
    <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        aria-label={`Play ${title}`}
        data-track="chat-video-open"
        className="group block w-full text-left disabled:cursor-wait"
      >
        <span className="relative block aspect-video w-full bg-slate-900">
          {card.thumbnailUrl && !imageFailed && (
            // eslint-disable-next-line @next/next/no-img-element -- the lesson's thumbnail, served by the course image route
            <img src={card.thumbnailUrl} alt="" loading="lazy" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover opacity-90 group-hover:opacity-100" />
          )}
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-14 w-20 items-center justify-center rounded-xl bg-plum-600 text-2xl text-white shadow-lg group-hover:bg-plum-700" aria-hidden="true">
              {busy ? "…" : "▶"}
            </span>
          </span>
        </span>
        <span className="block bg-white px-3 py-2 dark:bg-slate-900">
          <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{title}</span>
          <span className="block text-xs text-slate-600 dark:text-slate-400">{busy ? "Opening…" : subtitle}</span>
        </span>
      </button>
      {state.kind === "error" && (
        <p role="alert" className="border-t border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {state.message}
        </p>
      )}
    </div>
  );
}
