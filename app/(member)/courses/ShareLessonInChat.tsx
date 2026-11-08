"use client";

import { useState, useTransition } from "react";
import { shareLessonVideoInChat } from "@/app/(member)/chat/actions";
import type { ShareTarget } from "@/lib/chat/share-targets";

/**
 * "Share in chat" on a lesson with a video: pick a conversation, add a note if you like, and the video is posted
 * there as a card. Others play it in the message if they have the course; in Slack the message shows a link to the lesson.
 */
export default function ShareLessonInChat({ lessonId, targets, canOpenToChannel = false }: { lessonId: string; targets: ShareTarget[]; /** Admins only: offer to let everyone in the conversation play it, course or not. */ canOpenToChannel?: boolean }) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState(targets[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [openToChannel, setOpenToChannel] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: true; channelId: string } | { ok: false; error: string } | null>(null);

  if (targets.length === 0) return null;

  function submit() {
    start(async () => {
      const res = await shareLessonVideoInChat(channelId, lessonId, note, canOpenToChannel && openToChannel);
      if (res.ok) {
        setResult({ ok: true, channelId });
        setNote("");
      } else {
        setResult({ ok: false, error: res.error });
      }
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-track="lesson-share-in-chat-open"
        className="text-sm font-medium text-plum-600 hover:underline dark:text-plum-400"
      >
        Share this video in chat
      </button>
      {open && (
        <div className="mt-2 max-w-md space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <label className="block text-sm text-slate-700 dark:text-slate-300">
            Where
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-slate-700 dark:text-slate-300">
            Say something about it
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={1000}
              rows={2}
              className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </label>
          {canOpenToChannel && (
            <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
              <input type="checkbox" checked={openToChannel} onChange={(e) => setOpenToChannel(e.target.checked)} className="mt-0.5" />
              <span>
                Let everyone in this conversation watch it, even without the course
                <span className="block text-xs text-slate-600 dark:text-slate-400">Otherwise only members with the course can play it.</span>
              </span>
            </label>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={pending || !channelId}
            data-track="lesson-share-in-chat"
            className="rounded-md bg-plum-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-60"
          >
            {pending ? "Sharing…" : "Share"}
          </button>
          {result && (
            <p role="status" className="text-sm text-slate-700 dark:text-slate-300">
              {result.ok ? (
                <>
                  Shared. <a className="text-plum-600 underline dark:text-plum-400" href={`/chat/${result.channelId}`}>Open the conversation</a>
                </>
              ) : (
                result.error
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
