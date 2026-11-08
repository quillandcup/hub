"use client";

import { useState, useTransition } from "react";
import { shareLessonVideoInChat } from "@/app/(member)/chat/actions";
import EntitySearch from "@/components/EntitySearch";
import type { ShareTarget } from "@/lib/chat/share-targets";
import { OPEN_SHARE_PARAM, OPEN_SHARE_VALUE } from "@/lib/chat/lesson-links";

/**
 * "Share in chat" on a lesson with a video. Two ways: pick a conversation here, add a note if you like, and the video is posted
 * there as a card; or "Copy link to paste in chat", the lesson's address, which turns into the same card when sent in any
 * message (a thread or a direct message too), so you can take it anywhere without leaving the lesson. The copy button is
 * offered even with no conversation to pick from.
 *
 * The picked-conversation share: pick a conversation, add a note if you like, and the video is posted
 * there as a card. Others play it in the message if they have the course (or an admin opened it to everyone); in Slack the
 * message links back to the Hub. The conversation is picked from a searchable list that shows all of them on focus, and is only
 * preselected when there is one, so a share never goes to a conversation by default.
 */
export default function ShareLessonInChat({
  lessonId,
  targets,
  shareUrl,
  canOpenToChannel = false,
}: {
  lessonId: string;
  targets: ShareTarget[];
  /** The lesson's address, which is what "Copy link to paste in chat" copies. */
  shareUrl: string;
  /** Admins only: offer to let everyone in the conversation play it, course or not. */
  canOpenToChannel?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [channelId, setChannelId] = useState(targets.length === 1 ? targets[0].id : "");
  const [note, setNote] = useState("");
  const [openToChannel, setOpenToChannel] = useState(false);
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: true; channelId: string } | { ok: false; error: string } | null>(null);

  const [copied, setCopied] = useState<"yes" | "open" | "failed" | null>(null);

  const items = targets.map((t) => ({ id: t.id, name: t.label }));

  async function copyLink(open = false) {
    try {
      // The open link carries a marker that only counts when an admin sends it; for anyone else it is an ordinary closed share.
      await navigator.clipboard.writeText(open ? `${shareUrl}?${OPEN_SHARE_PARAM}=${OPEN_SHARE_VALUE}` : shareUrl);
      setCopied(open ? "open" : "yes");
    } catch {
      setCopied("failed");
    }
  }

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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {targets.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            data-track="lesson-share-in-chat-open"
            className="text-sm font-medium text-plum-600 hover:underline dark:text-plum-400"
          >
            Share this video in chat
          </button>
        )}
        <button
          type="button"
          onClick={() => copyLink()}
          data-track="lesson-copy-chat-link"
          className="text-sm font-medium text-plum-600 hover:underline dark:text-plum-400"
        >
          Copy link to paste in chat
        </button>
        {canOpenToChannel && (
          <button
            type="button"
            onClick={() => copyLink(true)}
            data-track="lesson-copy-chat-link-open"
            className="text-sm font-medium text-plum-600 hover:underline dark:text-plum-400"
          >
            Copy link, open to everyone in the conversation
          </button>
        )}
      </div>
      {copied && (
        <p role="status" className="mt-1 text-sm text-slate-700 dark:text-slate-300">
          {copied === "yes"
            ? "Copied. Paste it into any message in Hub Chat, in a thread or a direct message too, to share the video there."
            : copied === "open"
              ? "Copied. Paste it into any message in Hub Chat: everyone in that conversation can watch the video, even without the course. Only you, as an admin, can send this link that way."
              : "Couldn't copy. The lesson's address in your browser's address bar works the same way (it shares to members with the course only)."}
        </p>
      )}
      {open && targets.length > 0 && (
        <div className="mt-2 max-w-md space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <div className="text-sm text-slate-700 dark:text-slate-300">
            <span>Where</span>
            <EntitySearch
              className="mt-1"
              items={items}
              browse
              selectedId={channelId || null}
              onSelect={(item) => setChannelId(item?.id ?? "")}
              placeholder="Search your conversations"
              ariaLabel="Where to share"
              emptyText="No conversation matches"
            />
          </div>
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
