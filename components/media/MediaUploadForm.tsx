"use client";

import { useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import type { MediaSurface } from "@/lib/media/surfaces";

/** A file bigger than this goes straight to storage through a signed URL: a request body can't carry it. */
const DIRECT_UPLOAD_ABOVE = 4 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,.heic";

const BUTTON = "px-3 py-1.5 rounded text-sm";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700 disabled:opacity-50`;
const SECONDARY = `${BUTTON} bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50`;
const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm";

/**
 * Uploads an image to the media library: a file (dropped or chosen), an optional title and tags. HEIC photos
 * are converted by the server; a file too big for a request body goes through a signed storage URL. Calls
 * `onUploaded` with the new (or already existing) asset's id; failures go to `onError`.
 */
export default function MediaUploadForm({
  surface,
  onUploaded,
  onError,
  submitLabel = "Upload and use",
}: {
  surface: MediaSurface;
  onUploaded: (id: string) => void;
  onError: (message: string | null) => void;
  submitLabel?: string;
}) {
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
        {busy ? "Uploading..." : submitLabel}
      </button>
    </form>
  );
}
