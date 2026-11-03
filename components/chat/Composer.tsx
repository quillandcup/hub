"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { prepareChatUploads, saveChatDraft, sendChatMessage } from "@/app/(member)/chat/actions";
import MessageBox, { type MessageBoxHandle } from "@/components/chat/MessageBox";
import { messageFeatures } from "@/lib/chat/message-features";
import { NO_FORMATS, type FormatVia } from "@/lib/chat/format-text";
import { fromEditableText } from "@/lib/chat/render";
import { DRAFT_SAVE_DELAY_MS, fromDraftBody, toDraftBody } from "@/lib/chat/drafts";
import PendingAttachments from "@/components/chat/PendingAttachments";
import type { DraftFileView } from "@/lib/chat/draft-files";
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
 *
 * Drafts: what is typed and not sent is saved a moment after the last keystroke (and when the box is
 * left or the tab is hidden) and comes back as `initialDraft` the next time the box opens, so leaving
 * a conversation or an expired session loses nothing. With drafts on, attached files upload at once
 * (the draft lists their staged copies) and come back with the draft, previews and all. Sending clears it.
 */
export default function Composer({
  channelId,
  threadRootId,
  placeholder,
  viewer,
  showSent = true,
  dropTargetIds = [],
  initialDraft = null,
  initialDraftFiles = [],
  saveDrafts = false,
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
  /** The saved draft for this box (Slack markup, see `lib/chat/drafts.ts`), put back in it when it opens. */
  initialDraft?: string | null;
  /** The draft's files (already uploaded), with a link to preview each image. */
  initialDraftFiles?: DraftFileView[];
  /** Save what is typed as a draft. Off where it can't be (sudo is read-only). */
  saveDrafts?: boolean;
}) {
  const router = useRouter();
  const [restored] = useState(() => (initialDraft || initialDraftFiles.length > 0 ? { ...fromDraftBody(initialDraft ?? ""), hadFiles: initialDraftFiles.length > 0 } : null));
  const [text, setText] = useState(restored?.text ?? "");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attached, setAttached] = useState<File[]>([]);
  /** Files already uploaded to the member's staging folder (a draft's, or ones uploaded as they were attached). */
  const [stored, setStored] = useState<DraftFileView[]>(initialDraftFiles);
  /** Files being uploaded as they are attached, and the bytes sent so far for each. */
  const [staging, setStaging] = useState<File[]>([]);
  const [stagedBytes, setStagedBytes] = useState<Map<File, number>>(new Map());
  /** Preview links made here for staged files (revoked when the box goes). */
  const previewUrls = useRef<string[]>([]);
  const stagingAbort = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      stagingAbort.current?.abort();
      previewUrls.current.forEach((u) => URL.revokeObjectURL(u));
    },
    [],
  );
  /** Bytes sent so far for each attached file while sending. */
  const [sentBytes, setSentBytes] = useState<number[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const boxRef = useRef<MessageBoxHandle | null>(null);
  // People and channels picked in the box (shown name to Slack markup), turned into markup when sending.
  const mentionTokens = useRef(restored?.tokens ?? new Map<string, string>());
  const pickerRef = useRef<HTMLInputElement>(null);
  const early = Boolean(viewer) && showSent && attached.length === 0 && stored.length === 0;

  // The draft: what the server has stored (as Slack markup, "" for none), and a way for the timer, unmount and
  // tab-hide paths to save what is in the box now.
  const draftKey = (body: string, files: { path: string }[]) => JSON.stringify([body, files.map((f) => f.path)]);
  const savedDraft = useRef(draftKey(initialDraft ?? "", initialDraftFiles));
  const textRef = useRef(text);
  const storedRef = useRef(stored);
  const saveDraftNow = useCallback(() => {
    if (!saveDrafts) return;
    const typed = textRef.current;
    const body = typed.trim() === "" ? "" : toDraftBody(typed, mentionTokens.current);
    const files = storedRef.current.map(({ path, name, mimetype, size }) => ({ path, name, mimetype, size }));
    const key = draftKey(body, files);
    if (key === savedDraft.current) return;
    savedDraft.current = key;
    void saveChatDraft(channelId, threadRootId ?? null, body, files).catch(() => {});
  }, [saveDrafts, channelId, threadRootId]);
  const latestSaveDraft = useRef(saveDraftNow);
  useEffect(() => {
    textRef.current = text;
    storedRef.current = stored;
    latestSaveDraft.current = saveDraftNow;
  });
  useEffect(() => {
    if (restored) track("chat_draft_restored", { thread: threadRootId !== undefined });
    // Once, when the box opens with a draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = setTimeout(saveDraftNow, DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, stored, saveDraftNow]);
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState === "hidden") latestSaveDraft.current();
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      latestSaveDraft.current();
    };
  }, []);

  const formRef = useRef<HTMLFormElement>(null);
  const totalBytes = attached.reduce((n, f) => n + f.size, 0);
  const totalSent = sentBytes.reduce((n, v) => n + v, 0);
  // A ring over each file being sent, or being uploaded as it was attached.
  const fractions = attached.map((f, i) => {
    const sent = sending ? (sentBytes[i] ?? 0) : staging.includes(f) ? (stagedBytes.get(f) ?? 0) : null;
    return sent === null ? null : f.size === 0 ? 1 : Math.min(1, sent / f.size);
  });
  const dropLabel = threadRootId ? "Upload to thread" : `Upload to ${placeholder.replace(/^Message /, "")}`;

  /**
   * Upload files to the member's staging folder: several at once, results in the order given. The first
   * failure aborts the rest and gives null (with the error shown), the files staying where they are to
   * retry. Staged files left behind are swept by the staging cleanup (lib/chat/staging.ts).
   */
  const uploadFiles = async (list: File[], controller: AbortController, onProgress: (file: File, i: number, loaded: number) => void): Promise<StagedUpload[] | null> => {
    const prepared = await prepareChatUploads(list.map((f) => ({ name: f.name || "file", size: f.size }))).catch(() => null);
    if (controller.signal.aborted) return null;
    if (!prepared?.ok) {
      track("chat_upload_failed", { where: "message", stage: "prepare", count: list.length });
      setError(prepared?.error ?? "Couldn't start the upload. Try again.");
      return null;
    }
    const outcome = await runPool(
      list,
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
          onProgress: (loaded) => onProgress(file, i, loaded),
        });
        if (!result.ok) return { ok: false as const, error: result.reason };
        return { ok: true as const, value: { path, name: file.name || "file", mimetype: contentType, size: file.size } };
      },
      controller.signal,
    );
    if (!outcome.ok) {
      if (!outcome.aborted && outcome.error !== "aborted") {
        track("chat_upload_failed", { where: "message", stage: "upload", count: list.length });
        setError(`Couldn't upload ${list[outcome.index].name}. Try again.`);
      }
      return null;
    }
    return outcome.results;
  };

  /** Upload the attachments for a send; null (with the error shown) if any fails. */
  const uploadAttachments = async (): Promise<StagedUpload[] | null> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setSentBytes(attached.map(() => 0));
    return uploadFiles(attached, controller, (_file, i, loaded) => setSentBytes((current) => current.map((v, j) => (j === i ? loaded : v))));
  };

  /** Upload newly attached files right away; the ones that make it move from "attached" to the draft's files. A failure leaves them attached to be uploaded when sending. */
  const stage = async (incoming: File[]) => {
    const controller = (stagingAbort.current ??= new AbortController());
    setStaging((current) => [...current, ...incoming]);
    const done = await uploadFiles(incoming, controller, (file, _i, loaded) => setStagedBytes((current) => new Map(current).set(file, loaded)));
    setStaging((current) => current.filter((f) => !incoming.includes(f)));
    if (!done || controller.signal.aborted) return;
    const views = done.map((u, i) => {
      const preview = incoming[i].type.startsWith("image/") ? URL.createObjectURL(incoming[i]) : null;
      if (preview) previewUrls.current.push(preview);
      return { ...u, url: preview };
    });
    setAttached((current) => current.filter((f) => !incoming.includes(f)));
    setStored((current) => [...current, ...views]);
  };

  const attach = (incoming: File[], via: "picker" | "paste" | "drop" = "picker") => {
    if (incoming.length === 0) return;
    const tooBig = incoming.find((f) => f.size > MAX_CHAT_FILE_BYTES);
    if (tooBig) return setError(`${tooBig.name} is over ${MAX_CHAT_FILE_BYTES / (1024 * 1024)} MB.`);
    if (attached.length + stored.length + incoming.length > MAX_CHAT_FILES) return setError(`Attach up to ${MAX_CHAT_FILES} files at a time.`);
    setError(null);
    setAttached((current) => [...current, ...incoming]);
    track("chat_files_attached", { via, count: incoming.length });
    // With drafts on they upload now, so they are part of the draft.
    if (saveDrafts) void stage(incoming);
  };

  // Files dropped anywhere on the conversation column, or on the thread panel this box is in.
  const latestAttach = useRef(attach);
  useEffect(() => {
    latestAttach.current = attach;
  });
  const onDrop = useCallback((files: File[]) => latestAttach.current(files, "drop"), []);

  const { dragging, rect } = useFileDrop(() => dropTargetIds.map((id) => document.getElementById(id)), onDrop, !sending);

  /** Stop an upload in progress: nothing is sent, the files stay attached and the box is editable again. */
  const cancelUpload = () => {
    track("chat_upload_cancelled", { count: attached.length });
    abortRef.current?.abort();
  };

  // Whether the toolbar or a shortcut formatted anything in the message being written (for what is recorded when it is sent).
  const formatted = useRef<Record<FormatVia, boolean>>({ ...NO_FORMATS });

  const send = async () => {
    const typed = text.trim();
    if ((!typed && attached.length === 0 && stored.length === 0) || sending || staging.length > 0) return;
    const body = fromEditableText(typed, mentionTokens.current, { plain: true });
    // The message shown while it sends can't look the names up, so it carries them (`<@U1|Ania Ray>`).
    const labelled = new Map([...mentionTokens.current].map(([shown, token]) => [shown, token.replace(/>$/, `|${shown.slice(1)}>`)]));
    const shownBody = fromEditableText(typed, labelled, { plain: true });
    setError(null);
    setSending(true);
    let uploads: StagedUpload[] = stored.map(({ path, name, mimetype, size }) => ({ path, name, mimetype, size }));
    if (attached.length > 0) {
      const staged = await uploadAttachments();
      if (!staged) {
        setSentBytes([]);
        return setSending(false);
      }
      uploads = [...uploads, ...staged];
    }
    setText("");
    const tempId = `${PENDING_ID_PREFIX}${crypto.randomUUID()}`;
    if (early) emitListEvent({ kind: "add", channelId, threadRootId, view: optimisticView({ id: tempId, body: shownBody, viewer: viewer! }) });

    track("chat_message_composed", {
      where: threadRootId ? "reply" : "message",
      files: uploads.length,
      files_removed: 0,
      ...messageFeatures(body),
      used_toolbar: formatted.current.toolbar,
      used_shortcut: formatted.current.shortcut,
      used_typed: formatted.current.typed,
      used_paste: formatted.current.paste,
      used_tab: formatted.current.tab,
    });
    formatted.current = { ...NO_FORMATS };
    const result = await sendChatMessage(channelId, body, threadRootId, uploads).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
    setSending(false);
    setSentBytes([]);
    if (!result.ok) {
      if (early) emitListEvent({ kind: "drop", channelId, threadRootId, tempId });
      setText((current) => (current ? `${typed}\n${current}` : typed));
      setError(result.error);
      return;
    }
    setAttached([]);
    setStored([]);
    mentionTokens.current = new Map();
    // The server cleared the draft when it took the message.
    savedDraft.current = draftKey("", []);
    if (early) emitListEvent({ kind: "swap", channelId, threadRootId, tempId, view: optimisticView({ id: result.id, body: shownBody, viewer: viewer! }) });
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
      <div className="rounded-lg border border-slate-300 bg-white focus-within:border-plum-500 dark:border-slate-700 dark:bg-slate-900">
        <MessageBox
          id={`composer-${threadRootId ?? channelId}`}
          channelId={channelId}
          boxRef={boxRef}
          onFormat={(via) => {
            formatted.current[via] = true;
          }}
          tokens={mentionTokens}
          value={text}
          rows={2}
          maxLength={4000}
          placeholder={placeholder}
          onValueChange={setText}
          onPaste={(e) => {
            const pasted = [...(e.clipboardData?.files ?? [])];
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
        {(attached.length > 0 || stored.length > 0) && (
          <PendingAttachments
            files={attached}
            kept={stored}
            progress={sending || staging.length > 0 ? fractions : undefined}
            disabled={sending}
            onRemove={(i) => setAttached((current) => current.filter((_, j) => j !== i))}
            onRemoveKept={(i) => setStored((current) => current.filter((_, j) => j !== i))}
          />
        )}
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
            disabled={sending || staging.length > 0 || (text.trim() === "" && attached.length === 0 && stored.length === 0)}
            className="shrink-0 rounded-lg bg-plum-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-plum-700 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
      {sending && attached.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
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
