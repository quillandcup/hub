"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import type { PresetName } from "@/lib/media/presets";
import { mediaSrc } from "@/lib/media/url";

/** Where the picker is used; each is declared in the tracking plan. */
type Surface = "event_cover";

interface LibraryAsset {
  id: string;
  title: string;
  alt_text: string | null;
}

const PAGE = 24;
/** A file bigger than this goes straight to storage through a signed URL: a request body can't carry it. */
const DIRECT_UPLOAD_ABOVE = 4 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,.heic";

const BUTTON = "px-3 py-1.5 rounded text-sm";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700 disabled:opacity-50`;
const SECONDARY = `${BUTTON} bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50`;
const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm";

/**
 * Picks an image from the media library, or uploads a new one and uses it. Shows the current pick (at
 * `preview`'s crop, so you see what will be shown) with Choose / Change / Remove; Choose opens the library.
 * Staff only for now: the library routes it calls are.
 */
export default function MediaPicker({
  value,
  onChange,
  surface,
  preview = "event_card",
  disabled = false,
}: {
  value: string | null;
  onChange: (assetId: string | null) => void;
  surface: Surface;
  preview?: PresetName;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  function choose(id: string, from: "library" | "upload", searched: boolean) {
    track("media_picked", { surface, from, searched });
    onChange(id);
    setOpen(false);
  }

  return (
    <div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={mediaSrc(value, preview)} alt="The chosen image" className="w-full max-w-xs aspect-video object-cover rounded border border-gray-200 dark:border-slate-700" />
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-400">No image chosen.</p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          data-track="media-picker-open"
          disabled={disabled}
          onClick={() => {
            track("media_picker_opened", { surface });
            setOpen(true);
          }}
          className={SECONDARY}
        >
          {value ? "Change image" : "Choose image"}
        </button>
        {value && (
          <button
            type="button"
            data-track="media-picker-clear"
            disabled={disabled}
            onClick={() => {
              track("media_cleared", { surface });
              onChange(null);
            }}
            className={SECONDARY}
          >
            Remove
          </button>
        )}
      </div>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Choose an image" maxWidth="2xl">
        <PickerBody surface={surface} onPick={choose} />
      </Modal>
    </div>
  );
}

function PickerBody({ surface, onPick }: { surface: Surface; onPick: (id: string, from: "library" | "upload", searched: boolean) => void }) {
  const [tab, setTab] = useState<"library" | "upload">("library");
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (term: string, offset: number, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/media?q=${encodeURIComponent(term)}&limit=${PAGE}&offset=${offset}`, { signal });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn't load the library");
      const page: LibraryAsset[] = body.assets;
      setAssets((current) => (offset === 0 ? page : [...current, ...page]));
      setMore(page.length === PAGE);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  // Searches as you type, after a short pause.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => void load(q, 0, controller.signal), q ? 250 : 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, load]);

  return (
    <div>
      <div role="tablist" className="flex gap-4 border-b border-slate-200 dark:border-slate-800 mb-4">
        {(["library", "upload"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm -mb-px border-b-2 ${tab === t ? "border-plum-600 text-plum-700 dark:text-plum-300 font-medium" : "border-transparent text-slate-600 dark:text-slate-400"}`}
          >
            {t === "library" ? "Library" : "Upload"}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 p-3 rounded text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">{error}</p>}

      {tab === "library" ? (
        <div>
          <input
            type="search"
            aria-label="Search the library by title or tag"
            placeholder="Search by title or tag"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setSearched(true);
            }}
            className={`${INPUT} mb-3`}
          />
          {assets.length === 0 && !loading && !error ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {q ? "Nothing matches." : "No images yet."}{" "}
              <button type="button" onClick={() => setTab("upload")} className="text-plum-600 dark:text-plum-400 hover:underline">
                Upload one
              </button>
            </p>
          ) : (
            <div className="@container">
              <ul className="grid grid-cols-2 @pair:grid-cols-3 gap-3">
                {assets.map((a) => (
                  <li key={a.id}>
                    <button type="button" data-track="media-picker-choose" onClick={() => onPick(a.id, "library", searched)} className="block w-full text-left group">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset */}
                      <img src={mediaSrc(a.id, "thumb")} alt={a.alt_text ?? ""} loading="lazy" className="w-full aspect-square object-cover rounded border border-gray-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-plum-500" />
                      <span className="block mt-1 text-xs truncate">{a.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Loading...</p>}
          {more && !loading && (
            <button type="button" onClick={() => void load(q, assets.length)} className={`${SECONDARY} mt-3`}>
              Show more
            </button>
          )}
        </div>
      ) : (
        <UploadForm surface={surface} onUploaded={(id) => onPick(id, "upload", false)} onError={setError} />
      )}
    </div>
  );
}

function UploadForm({ surface, onUploaded, onError }: { surface: Surface; onUploaded: (id: string) => void; onError: (message: string | null) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true);
    onError(null);
    const large = file.size > DIRECT_UPLOAD_ABOVE;
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      let response: Response;
      if (large) {
        // Too big for a request body: straight to storage through a signed URL, then ask the library to take it.
        const start = await fetch("/api/media/uploads", { method: "POST" });
        const slot = await start.json();
        if (!start.ok) throw new Error(slot.error || "Couldn't start the upload");
        const { error } = await createClient().storage.from("media").uploadToSignedUrl(slot.uploadPath, slot.token, file, { contentType: file.type || "application/octet-stream" });
        if (error) throw new Error("The upload didn't go through. Try again");
        response = await fetch("/api/media", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadPath: slot.uploadPath, title: title || undefined, tags: tagList }),
        });
      } else {
        const form = new FormData();
        form.set("file", file);
        if (title) form.set("title", title);
        if (tagList.length) form.set("tags", tagList.join(","));
        response = await fetch("/api/media", { method: "POST", body: form });
      }
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Upload failed");
      track("media_uploaded", { surface, ok: true, converted: body.convertedFrom === "heic", duplicate: !!body.duplicate, large });
      onUploaded(body.asset.id);
    } catch (err) {
      track("media_uploaded", { surface, ok: false, converted: false, duplicate: false, large });
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const dropped = e.dataTransfer.files[0];
          if (dropped) setFile(dropped);
        }}
        className={`rounded border-2 border-dashed p-6 text-center text-sm ${dragging ? "border-plum-500 bg-plum-50 dark:bg-plum-900/20" : "border-gray-300 dark:border-slate-700"}`}
      >
        <p className="mb-2">{file ? file.name : "Drop an image here, or"}</p>
        <button type="button" onClick={() => input.current?.click()} className={SECONDARY}>
          {file ? "Choose a different file" : "Choose a file"}
        </button>
        <input ref={input} type="file" accept={ACCEPT} aria-label="Image file" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">JPEG, PNG, WebP, GIF, AVIF or an iPhone HEIC photo, up to 25 MB.</p>
      </div>
      <label className="block text-sm">
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="From the file name if left empty" className={`${INPUT} mt-1`} />
      </label>
      <label className="block text-sm">
        Tags
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hedgies-on-first, retreat" className={`${INPUT} mt-1`} />
      </label>
      <button type="submit" disabled={!file || busy} className={PRIMARY}>
        {busy ? "Uploading..." : "Upload and use"}
      </button>
    </form>
  );
}
