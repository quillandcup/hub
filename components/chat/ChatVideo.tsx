"use client";

import { useState } from "react";
import LessonPlayer from "@/components/courses/LessonPlayer";
import type { PlaybackTokens } from "@/lib/mux";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string; lessonId: string; playbackId: string; tokens: PlaybackTokens; restricted: boolean; record: boolean; resumeSeconds: number }
  | { kind: "error"; message: string };

/**
 * A course lesson's video shared in a message. It shows a card; pressing play asks /api/chat/videos/<message id> for
 * playback links for this viewer (the server checks they can read the message and have the course), then the course
 * player takes over. Nothing is fetched until then, so a long conversation mints no links it doesn't need. What is
 * watched is recorded like a lesson view (resume included) but tagged with this message, so the staff watch stats keep
 * chat views apart from the lesson's own. The route says when not to record (sudo, a lesson not open to members).
 */
export default function ChatVideo({ messageId }: { messageId: string }) {
  const [state, setState] = useState<State>({ kind: "idle" });

  async function open() {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/chat/videos/${messageId}`, { method: "POST" });
      if (res.status === 403) {
        setState({ kind: "error", message: "This video is part of a course you don't have access to." });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: res.status === 429 ? "Too many videos opened just now. Try again in a few minutes." : "This video isn't available right now." });
        return;
      }
      const body = (await res.json()) as { title: string; lessonId: string; playbackId: string; tokens: PlaybackTokens; restricted: boolean; record: boolean; resumeSeconds: number };
      setState({ kind: "ready", ...body });
    } catch {
      setState({ kind: "error", message: "This video isn't available right now." });
    }
  }

  if (state.kind === "ready") {
    return (
      <div className="mt-2 max-w-xl overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
        <LessonPlayer
          title={state.title}
          playbackId={state.playbackId}
          tokens={state.tokens}
          restricted={state.restricted}
          lessonId={state.lessonId}
          chatMessageId={messageId}
          resumeSeconds={state.resumeSeconds}
          trackProgress={state.record}
        />
        <p className="px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-100">{state.title}</p>
      </div>
    );
  }

  return (
    <div className="mt-2 max-w-xl rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
      <button
        type="button"
        onClick={open}
        disabled={state.kind === "loading"}
        data-track="chat-video-open"
        className="inline-flex items-center gap-2 rounded-md bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-60"
      >
        <span aria-hidden>▶</span>
        {state.kind === "loading" ? "Opening…" : "Watch the video"}
      </button>
      <span className="ml-2 text-xs text-slate-600 dark:text-slate-400">A lesson video from a course</span>
      {state.kind === "error" && (
        <p role="alert" className="mt-2 text-sm text-slate-700 dark:text-slate-300">
          {state.message}
        </p>
      )}
    </div>
  );
}
