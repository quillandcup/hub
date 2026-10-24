"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareChatUploads, sendChatMessage } from "@/app/(member)/chat/actions";
import PendingAttachments from "@/components/chat/PendingAttachments";
import { useFileDrop } from "@/components/chat/useFileDrop";
import { track } from "@/lib/analytics/client";
import { MAX_CHAT_FILES, MAX_CHAT_FILE_BYTES, type StagedUpload } from "@/lib/chat/staging";
import { SLACK_FILES_BUCKET } from "@/lib/slack-capture";
import { CHAT_UPLOAD_CONCURRENCY, runPool } from "@/lib/chat/upload-pool";
import { signedUploadUrl, uploadWithProgress } from "@/lib/chat/upload-progress";
import { PENDING_ID_PREFIX, emitListEvent, optimisticView, pokeChat } from "@/lib/chat/list-events";

/**
 * The box a member writes in, under a conversation or inside a thread. Enter sends, Shift+Enter
 * starts a new line.
 *
 * The box clears and the message appears in the list the moment Send is pressed,
 * "Sending to Slack…" until Slack has it, instead of waiting for the server action and then for the
 * whole page to re-render, which took seconds. The action's real message replaces the placeholder;
 * a refused or failed send takes it away and puts the text back. Afterwards the conversation is
 * asked to catch up (in the background, and Realtime does too) so what is shown is what the server has.
 *
 * Files: the paperclip, pasting an image or dropping files adds attachments. They go straight from
 * the browser to private storage (a server action can't take a big body), then the message is sent
 * with them. A message with files isn't shown early: it waits for its uploads.
 */
export default function Composer({
  channelId,
  threadRootId,
  placeholder,
  viewer,
  showSent = true,
  dropTargetIds = [],
}: {
  channelId: string;
  threadRootId?: string;
  placeholder: string;
  /** Who is writing, for the message shown while it is sent. Without it nothing is shown early. */
  viewer?: { memberId: string; name: string; photoUrl: string | null };
  /** Show the sent message in the list at once (the conversation's, or the thread's for a reply). Off on older pages. */
  showSent?: boolean;
  /**
   * Ids of the elements files may be dropped on to attach them here: the conversation column, and
   * the profile panel beside it (which has no box of its own). Ones that aren't on the page are
   * skipped. Without any, dropping does nothing.
   */
  dropTargetIds?: string[];
}) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<File[]>([]);
  /** Bytes sent so far for each attached file while sending. */
  const [sentBytes, setSentBytes] = useState<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const boxRef = useRef<HTMLTextAreaElement>(null);
  const pickerRef = useRef<HTMLInputElement>(null);
  const early = Boolean(viewer) && showSent && attached.length === 0;

  const formRef = useRef<HTMLFormElement>(null);
  const attach = (incoming: File[], via: "picker" | "paste" | "drop" = "picker") => {
    if (incoming.length === 0) return;
    const tooBig = incoming.find((f) => f.size > MAX_CHAT_FILE_BYTES);
    if (tooBig) return setError(`${tooBig.name} is over ${MAX_CHAT_FILE_BYTES / (1024 * 1024)} MB.`);
    if (attached.length + incoming.length > MAX_CHAT_FILES) return setError(`Attach up to ${MAX_CHAT_FILES} files at a time.`);
    setError(null);
    setAttached((current) => [...current, ...incoming]);
    track("chat_files_attached", { via, count: incoming.length });
  };

  // Files dropped anywhere on the conversation column, or on the thread panel this box is in.
  const latestAttach = useRef(attach);
  useEffect(() => {
    latestAttach.current = attach;
  });
  const onDrop = useCallback((files: File[]) => latestAttach.current(files, "drop"), []);
  const { dragging, rect } = useFileDrop(() => dropTargetIds.map((id) => document.getElementById(id)), onDrop, !sending);
  const totalBytes = attached.reduce((n, f) => n + f.size, 0);
  const totalSent = sentBytes.reduce((n, v) => n + v, 0);
  const fractions = attached.map((f, i) => (f.size === 0 ? 1 : Math.min(1, (sentBytes[i] ?? 0) / f.size)));
  const dropLabel = threadRootId ? "Upload to thread" : `Upload to ${placeholder.replace(/^Message /, "")}`;

  /** Upload the attachments to the member's staging folder; null (with the error shown) if any fails. */
  const uploadAttachments = async (): Promise<StagedUpload[] | null> => {
    const controller = new AbortController();
    abortRef.current = controller;
    const prepared = await prepareChatUploads(attached.map((f) => ({ name: f.name || "file", size: f.size }))).catch(() => null);
    if (controller.signal.aborted) return null;
    if (!prepared?.ok) {
      setError(prepared?.error ?? "Couldn't start the upload. Try again.");
      return null;
    }
    setSentBytes(attached.map(() => 0));
    // Several at once; results keep the order the files were attached in. The first failure aborts the
    // rest, nothing is sent and the files stay attached to retry. Staged files left behind are swept by
    // the staging cleanup (lib/chat/staging.ts).
    const outcome = await runPool(
      attached,
      CHAT_UPLOAD_CONCURRENCY,
      async (file, i, signal) => {
        const { path, token } = prepared.uploads[i];
        const contentType = file.type || "application/octet-stream";
        const result = await uploadWithProgress({
          url: signedUploadUrl(process.env.NEXT_PUBLIC_SUPABASE_URL!, SLACK_FILES_BUCKET, path, token),
          file,
          contentType,
          apiKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          signal,
          onProgress: (loaded) => setSentBytes((current) => current.map((v, j) => (j === i ? loaded : v))),
        });
        if (!result.ok) return { ok: false as const, error: result.reason };
        return { ok: true as const, value: { path, name: file.name || "file", mimetype: contentType, size: file.size } };
      },
      controller.signal,
    );
    if (!outcome.ok) {
      if (!outcome.aborted && outcome.error !== "aborted") setError(`Couldn't upload ${attached[outcome.index].name}. Try again.`);
      return null;
    }
    return outcome.results;
  };

  /** Stop an upload in progress: nothing is sent, the files stay attached and the box is editable again. */
  const cancelUpload = () => {
    track("chat_upload_cancelled", { count: attached.length });
    abortRef.current?.abort();
  };

  const send = async () => {
    const body = text.trim();
    if ((!body && attached.length === 0) || sending) return;
    setError(null);
    setSending(true);
    let uploads: StagedUpload[] = [];
    if (attached.length > 0) {
      const staged = await uploadAttachments();
      if (!staged) {
        setSentBytes([]);
        return setSending(false);
      }
      uploads = staged;
    }
    setText("");
    const tempId = `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
    if (early) emitListEvent({ kind: "add", channelId, threadRootId, view: optimisticView({ id: tempId, body, viewer: viewer! }) });

    const result = await sendChatMessage(channelId, body, threadRootId, uploads).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setSending(false);
    setSentBytes([]);
    if (!result.ok) {
      if (early) emitListEvent({ kind: "drop", channelId, threadRootId, tempId });
      setText((current) => (current ? `${body}\n${current}` : body));
      setError(result.error);
      return;
    }
    setAttached([]);
    if (early) emitListEvent({ kind: "swap", channelId, threadRootId, tempId, view: optimisticView({ id: result.id, body, viewer: viewer! }) });
    // Bring the conversation up to date: just its newest messages when it is open here, else the page.
    if (!pokeChat(channelId)) router.refresh();
    boxRef.current?.focus();
  };

  return (
    <form
      ref={formRef}
      className="shrink-0 border-t border-slate-200 px-6 py-3 dark:border-slate-800"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {dragging && rect && (
        <div
          aria-hidden
          style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          className="pointer-events-none fixed z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-plum-500 bg-plum-50/80 text-lg font-semibold text-plum-700 dark:bg-slate-900/80 dark:text-plum-300"
        >
          {dropLabel}
        </div>
      )}
      <label className="sr-only" htmlFor={`composer-${threadRootId ?? channelId}`}>
        {placeholder}
      </label>
      <div className="rounded-lg border border-slate-300 bg-white focus-within:border-plum-500 dark:border-slate-700 dark:bg-slate-900">
        <textarea
          id={`composer-${threadRootId ?? channelId}`}
          ref={boxRef}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const pasted = [...e.clipboardData.files];
            if (pasted.length === 0) return;
            e.preventDefault();
            attach(pasted, "paste");
          }}
          onKeyDown={(e) => {
            // Not while an input method is composing (Enter picks a candidate then).
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
          className="block w-full resize-none rounded-t-lg border-0 bg-transparent px-3 py-2 text-sm focus:outline-none"
        />
        {attached.length > 0 && <PendingAttachments files={attached} progress={sending ? fractions : undefined} disabled={sending} onRemove={(i) => setAttached((current) => current.filter((_, j) => j !== i))} />}
        <div className="flex items-center justify-between gap-2 px-2 py-1.5">
          <input
            ref={pickerRef}
            type="file"
            multiple
            hidden
            aria-label="Attach files"
            onChange={(e) => {
              attach([...e.target.files!]);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            data-track="chat-composer-attach"
            aria-label="Attach files"
            title="Attach files"
            disabled={sending}
            onClick={() => pickerRef.current?.click()}
            className="shrink-0 rounded-lg px-2 py-1 text-sm hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800"
          >
            📎
          </button>
          <button
            type="submit"
            data-track="chat-composer-send"
            disabled={sending || (text.trim() === "" && attached.length === 0)}
            className="shrink-0 rounded-lg bg-plum-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {sending && attached.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          <progress aria-label="Upload progress" max={Math.max(totalBytes, 1)} value={totalSent} className="h-1.5 flex-1 accent-plum-600" />
          <span>{totalBytes > 0 ? Math.round((totalSent / totalBytes) * 100) : 100}% uploaded</span>
          <button
            type="button"
            data-track="chat-composer-cancel-upload"
            onClick={cancelUpload}
            className="shrink-0 rounded-lg px-2 py-0.5 text-xs font-medium text-plum-700 hover:bg-slate-100 dark:text-plum-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
