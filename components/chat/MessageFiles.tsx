"use client";

import { useState, useTransition } from "react";
import { deleteChatFile } from "@/app/(member)/chat/actions";
import { track } from "@/lib/analytics/client";
import { useAnimationsOff } from "@/components/AnimationsController";
import ImageLightbox from "@/components/ImageLightbox";
import { chatFileUrl, chatZipUrl, formatFileSize, isInlineImage, type ChatFile } from "@/lib/chat/files";

const iconBtn = "inline-flex h-6 w-6 items-center justify-center rounded text-sm text-white hover:bg-white/20";

function triggerDownload(href: string, name: string | null) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name ?? "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function ImageTile({
  messageId,
  file,
  canDelete,
  onDelete,
  onOpen,
}: {
  messageId: string;
  file: ChatFile;
  canDelete: boolean;
  onDelete: (f: ChatFile) => void;
  onOpen: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [playing, setPlaying] = useState(false);
  const animationsOff = useAnimationsOff();
  const moves = /gif|webp/i.test(file.mimetype ?? "");
  const stills = animationsOff && moves;
  const togglePlay = () => {
    track("gif_play_toggled", { playing: !playing });
    setPlaying((p) => !p);
  };
  const url = chatFileUrl(messageId, file.id);
  const absolute = () => new URL(url, window.location.origin).toString();

  const copyImage = async () => {
    try {
      const blob = await (await fetch(url)).blob();
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
    } catch {
      await navigator.clipboard.writeText(absolute());
    }
  };
  const item = "block w-full px-3 py-1.5 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700";
  const close = (fn: () => void | Promise<void>) => () => {
    setMenu(false);
    void fn();
  };

  return (
    <div className="group relative shrink-0 rounded-lg border border-slate-200 dark:border-slate-700" data-testid="message-image">
      {/* Animations off: the picture itself plays and pauses (Expand is in the toolbar); otherwise it enlarges. */}
      <button
        type="button"
        onClick={stills ? togglePlay : onOpen}
        aria-label={stills ? `${playing ? "Pause" : "Play"} ${file.name ?? "image"}` : `Enlarge ${file.name ?? "image"}`}
        aria-pressed={stills ? playing : undefined}
        data-track={stills ? "chat-gif-play" : "chat-file-open"}
        className="block overflow-hidden rounded-lg"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served through the access-checked chat files route, not an optimizable asset */}
        <img
          src={url}
          alt={file.name ?? "Image"}
          width={file.width ?? undefined}
          height={file.height ?? undefined}
          loading="lazy"
          data-animated={moves ? "" : undefined}
          data-playing={stills && playing ? "" : undefined}
          className="block h-auto max-h-48 w-auto max-w-full"
        />
        {stills && (
          <span
            data-testid="gif-state-icon"
            aria-hidden
            className={`pointer-events-none absolute left-1/2 top-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-slate-900/80 text-xl text-white ${
              // Playing: shown on hover or keyboard focus; a touch screen has no hover, so there it stays, or nothing says a tap pauses.
              playing ? "opacity-0 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 [@media(hover:none)]:opacity-100" : ""
            }`}
          >
            {playing ? "❚❚" : "▶"}
          </span>
        )}
      </button>
      {/* Slack's layout: a small dark group in the top-right corner, clear of the picture's middle; delete is in More. */}
      <div className="absolute right-1.5 top-1.5 hidden items-center gap-0.5 rounded-md bg-slate-900/70 p-0.5 group-focus-within:flex group-hover:flex">
        {stills && (
          <button type="button" aria-label={`Expand ${file.name ?? "image"}`} title="Expand" data-track="chat-file-open" onClick={onOpen} className={iconBtn}>
            🔍
          </button>
        )}
        <a href={url} download={file.name ?? undefined} aria-label={`Download ${file.name ?? "image"}`} data-track="chat-file-download" className={iconBtn}>
          ⬇
        </a>
        <div className="relative">
          <button type="button" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((v) => !v)} className={iconBtn}>
            ⋮
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 top-full z-10 mt-1 w-40 rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <button role="menuitem" type="button" className={item} onClick={close(() => navigator.clipboard.writeText(absolute()))}>
                Copy link
              </button>
              <button role="menuitem" type="button" className={item} onClick={close(copyImage)}>
                Copy image
              </button>
              <a role="menuitem" href={url} target="_blank" rel="noopener noreferrer" className={item} onClick={() => setMenu(false)}>
                Open in new tab
              </a>
              <a role="menuitem" href={url} download={file.name ?? undefined} className={item} onClick={() => setMenu(false)}>
                Download
              </a>
              {canDelete && (
                <button role="menuitem" type="button" className={`${item} text-red-600`} onClick={close(() => onDelete(file))}>
                  Delete file
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A message's files under a "N attachments" header (collapsible, with Download all): images (and
 * GIFs) side by side, the rest as download chips. `canDelete` (the viewer posted the message) adds
 * the remove controls.
 */
export default function MessageFiles({ messageId, files, canDelete = false }: { messageId: string; files: ChatFile[]; canDelete?: boolean }) {
  const [open, setOpen] = useState(true);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [enlarged, setEnlarged] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const shown = files.filter((f) => !removed.has(f.id));
  if (shown.length === 0) return null;
  const images = shown.filter(isInlineImage);
  const others = shown.filter((f) => !isInlineImage(f));

  const remove = (f: ChatFile) => {
    if (!window.confirm(`Delete ${f.name ?? "this file"}? This also removes it from Slack.`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteChatFile(messageId, f.id);
      if (result.ok) setRemoved((prev) => new Set(prev).add(f.id));
      else setError(result.error);
    });
  };
  const downloadAll = () => {
    if (shown.length === 1) triggerDownload(chatFileUrl(messageId, shown[0].id), shown[0].name);
    else triggerDownload(chatZipUrl(messageId), "attachments.zip");
  };

  return (
    <div className="mt-1.5 flex flex-col gap-2" data-testid="message-files">
      <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          {shown.length} {shown.length === 1 ? "attachment" : "attachments"}
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        </button>
        <span aria-hidden="true">|</span>
        <button type="button" onClick={downloadAll} data-track="chat-file-download-all" className="hover:text-slate-700 dark:hover:text-slate-200">
          Download all
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      {open && (
        <>
          {images.length > 0 && (
            <div className="flex flex-row gap-2 overflow-x-auto pb-1">
              {images.map((f) => (
                <ImageTile key={f.id} messageId={messageId} file={f} canDelete={canDelete} onDelete={remove} onOpen={() => setEnlarged(images.indexOf(f))} />
              ))}
            </div>
          )}
          {others.map((f) => (
            <a
              key={f.id}
              href={chatFileUrl(messageId, f.id)}
              download={f.name ?? undefined}
              data-track="chat-file-download"
              className="inline-flex w-fit max-w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <span aria-hidden="true">📎</span>
              <span className="truncate">{f.name ?? "File"}</span>
              {f.size !== null && <span className="shrink-0 text-xs text-slate-600 dark:text-slate-400">{formatFileSize(f.size)}</span>}
            </a>
          ))}
        </>
      )}
      {enlarged !== null && (
        <ImageLightbox
          images={images.map((f) => ({ src: chatFileUrl(messageId, f.id), name: f.name ?? "Image" }))}
          startIndex={enlarged}
          onClose={() => setEnlarged(null)}
        />
      )}
    </div>
  );
}
