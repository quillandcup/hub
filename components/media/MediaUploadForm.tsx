"use client";

import { useRef, useState } from "react";
import { track } from "@/lib/analytics/client";
import { createClient } from "@/lib/supabase/client";
import { BOOK_COVER_MAX_BYTES, describeBookCoverRequirements } from "@/lib/bookCover";
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
 * `onUploaded` with the new (or already existing) asset's id and size; failures go to `onError`. With `own` it is
 * a member's upload into their own images (`/api/bookshelf/cover`): no title or tags, one request, up to 4 MB.
 */
export default function MediaUploadForm({
  surface,
  onUploaded,
  onError,
  submitLabel = "Upload and use",
  own = false,
}: {
  surface: MediaSurface;
  onUploaded: (id: string, asset: { id: string; width: number; height: number }) => void;
  onError: (message: string | null) => void;
  submitLabel?: string;
  own?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  // Not a <form>: this sits inside other forms (an event's edit form, the add form), and a form in a form submits the
  // outer one too, saving the event with nothing chosen yet. Enter in a field sends, instead of submitting what is around it.
  async function send() {
    if (!file || busy) return;
    onError(null);
    if (own && file.size > BOOK_COVER_MAX_BYTES) {
      onError(`Cover must be under ${BOOK_COVER_MAX_BYTES / (1024 * 1024)} MB`);
      return;
    }
    setBusy(true);
    const large = !own && file.size > DIRECT_UPLOAD_ABOVE;
    try {
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      let response: Response;
      if (own) {
        const form = new FormData();
        form.set("file", file);
        response = await fetch("/api/bookshelf/cover", { method: "POST", body: form });
      } else if (large) {
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
      // The staff route answers { asset }, a member's own { assetId, width, height }.
      const uploaded = own ? { id: body.assetId, width: body.width, height: body.height } : { id: body.asset.id, width: body.asset.width, height: body.asset.height };
      onUploaded(uploaded.id, uploaded);
    } catch (err) {
      track("media_uploaded", { surface, ok: false, converted: false, duplicate: false, large });
      // A request that never got an answer is a TypeError ("Failed to fetch"): say something a person can use.
      onError(err instanceof TypeError ? "Upload failed, try again" : (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function sendOnEnter(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void send();
  }

  return (
    <div className="space-y-3">
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
        <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{own ? describeBookCoverRequirements() : "JPEG, PNG, WebP, GIF, AVIF or an iPhone HEIC photo, up to 25 MB."}</p>
      </div>
      {!own && (
      <label className="block text-sm">
        Title
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={sendOnEnter} placeholder="From the file name if left empty" className={`${INPUT} mt-1`} />
      </label>
      )}
      {!own && (
      <label className="block text-sm">
        Tags
        <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} onKeyDown={sendOnEnter} placeholder="hedgies-on-first, retreat" className={`${INPUT} mt-1`} />
      </label>
      )}
      <button type="button" onClick={() => void send()} disabled={!file || busy} className={PRIMARY}>
        {busy ? "Uploading..." : submitLabel}
      </button>
    </div>
  );
}
