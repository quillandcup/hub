"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import { mediaSrc } from "@/lib/media/url";
import { MAX_CUSTOM_SIDE } from "@/lib/media/custom";
import { FIT_MODES, PRESETS, type FitMode } from "@/lib/media/presets";
import type { MediaAsset, MediaUsage } from "@/lib/data/media";

const INPUT = "w-full px-3 py-2 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm";
const BUTTON = "px-3 py-1.5 rounded text-sm";
const PRIMARY = `${BUTTON} bg-plum-600 text-white hover:bg-plum-700 disabled:opacity-50`;
const SECONDARY = `${BUTTON} bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-slate-600 disabled:opacity-50`;
const LINK = "text-plum-600 dark:text-plum-400 hover:underline text-sm";

const FIT_LABELS: Record<FitMode, string> = {
  crop: "Crop to fill",
  extend: "Keep all of it, continue the edges",
  white: "Keep all of it, on white",
};
/** The presets that are book covers: how a picture of another shape fits them is one choice. */
const COVER_PRESETS = ["book_cover_shelf", "book_cover_kdp_ebook"] as const;

/** What a download may ask for. The link takes its words from these tables, never from what the dropdowns hold. */
const FORMAT_PARAM: Record<string, string> = { jpeg: "jpeg", png: "png", webp: "webp" };
const FIT_PARAM: Record<FitMode, string> = { crop: "crop", extend: "extend", white: "white" };

/** Where staff can open a place that uses the image; a book or a member's project has no staff page. */
const usageLink = (u: MediaUsage) => (u.kind === "event" ? `/admin/events/${u.id}` : null);

/** One image: its details, where it's used, its focal point and cover fit, and downloads. Saves, deletes. */
export default function MediaEditor({ assetId, onClose, onChanged }: { assetId: string; onClose: () => void; onChanged: () => void }) {
  const [asset, setAsset] = useState<MediaAsset | null>(null);
  const [usages, setUsages] = useState<MediaUsage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const [title, setTitle] = useState("");
  const [alt, setAlt] = useState("");
  const [tags, setTags] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [focal, setFocal] = useState<{ x: number; y: number } | null>(null);
  const [coverFit, setCoverFit] = useState<FitMode>("extend");

  const [width, setWidth] = useState("1600");
  const [height, setHeight] = useState("2560");
  const [format, setFormat] = useState("jpeg");
  const [customFit, setCustomFit] = useState<FitMode>("crop");

  function fill(a: MediaAsset) {
    setAsset(a);
    setTitle(a.title);
    setAlt(a.alt_text ?? "");
    setTags(a.tags.join(", "));
    setIsPublic(a.is_public);
    setFocal(a.focal_x !== null && a.focal_y !== null ? { x: Number(a.focal_x), y: Number(a.focal_y) } : null);
    const fits = (a.fits ?? {}) as Record<string, string>;
    setCoverFit(FIT_MODES.find((m) => m === fits.book_cover_shelf) ?? PRESETS.book_cover_shelf.defaultFit);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/media/${assetId}`);
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Couldn't load the image");
        if (cancelled) return;
        fill(body.asset);
        setUsages(body.usages);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!asset) return;
    setBusy(true);
    setError(null);
    const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
    const before = (asset.fits ?? {}) as Record<string, string>;
    const fitChanged = (before.book_cover_shelf ?? PRESETS.book_cover_shelf.defaultFit) !== coverFit;
    const focalChanged = JSON.stringify(focal) !== JSON.stringify(asset.focal_x !== null ? { x: Number(asset.focal_x), y: Number(asset.focal_y) } : null);
    const patch = {
      title,
      alt_text: alt,
      tags: tagList,
      is_public: isPublic,
      focal,
      ...(fitChanged ? { fits: Object.fromEntries(COVER_PRESETS.map((p) => [p, coverFit])) } : {}),
    };
    try {
      const response = await fetch(`/api/media/${assetId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Couldn't save");
      track("media_edited", {
        title: title.trim() !== asset.title,
        alt: (alt.trim() || null) !== asset.alt_text,
        tags: tagList.join(",") !== asset.tags.join(","),
        focal: focalChanged,
        fit: fitChanged,
        is_public: isPublic !== asset.is_public,
      });
      fill(body.asset);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setConfirmingDelete(false);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/media/${assetId}`, { method: "DELETE" });
      const body = await response.json();
      if (response.status === 409) {
        track("media_deleted", { ok: false, in_use: true });
        setUsages(body.usages);
        throw new Error(body.error);
      }
      if (!response.ok) throw new Error(body.error || "Couldn't delete");
      track("media_deleted", { ok: true, in_use: false });
      onChanged();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Whole pixels within what the route accepts, and only the formats and fits it knows: what is typed never reaches the link as text.
  const pixels = (typed: string) => Math.min(MAX_CUSTOM_SIDE, Math.max(1, Math.trunc(Number(typed)) || 1));
  const customFormat = Object.hasOwn(FORMAT_PARAM, format) ? FORMAT_PARAM[format] : "jpeg";
  const customFitParam = Object.hasOwn(FIT_PARAM, customFit) ? FIT_PARAM[customFit] : "crop";
  const customHref = `/api/media/${assetId}/custom?width=${pixels(width)}&height=${pixels(height)}&format=${customFormat}&fit=${customFitParam}&download=1`;
  const version = asset?.updated_at;
  // The whole picture, never cropped: a size with the picture's own shape (longest side 800), so a click maps straight to a point on it.
  const scale = asset ? 800 / Math.max(asset.width, asset.height) : 1;
  const wholeWidth = asset ? Math.max(1, Math.round(asset.width * scale)) : 0;
  const wholeHeight = asset ? Math.max(1, Math.round(asset.height * scale)) : 0;

  return (
    <Modal isOpen onClose={onClose} title={asset?.title ?? "Image"} maxWidth="2xl">
      {error && <p role="alert" className="mb-3 p-3 rounded text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">{error}</p>}
      {!asset ? (
        !error && <p className="text-slate-600 dark:text-slate-400">Loading...</p>
      ) : (
        <form onSubmit={save} className="space-y-5">
          <div>
            <p className="text-sm mb-1">Click the picture to say where the interesting part is. Crops stay centred on it.</p>
            <div className="relative inline-block max-w-full">
              {/* eslint-disable-next-line @next/next/no-img-element -- the whole picture from the media route, sized to its own shape */}
              <img
                src={`/api/media/${assetId}/custom?width=${wholeWidth}&height=${wholeHeight}&format=webp&fit=crop${version ? `&v=${encodeURIComponent(version)}` : ""}`}
                alt={asset.alt_text ?? asset.title}
                onClick={(e) => {
                  const box = e.currentTarget.getBoundingClientRect();
                  setFocal({ x: Math.round(((e.clientX - box.left) / box.width) * 1000) / 1000, y: Math.round(((e.clientY - box.top) / box.height) * 1000) / 1000 });
                }}
                className="max-w-full max-h-80 rounded border border-gray-200 dark:border-slate-700 cursor-crosshair"
              />
              {focal && <span data-testid="focal-marker" className="absolute w-4 h-4 -ml-2 -mt-2 rounded-full border-2 border-white bg-plum-600 shadow pointer-events-none" style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} />}
            </div>
            <div className="mt-1 flex gap-3 items-center text-xs text-slate-600 dark:text-slate-400">
              <span>{asset.width} x {asset.height} px · {asset.mime_type.replace("image/", "")}</span>
              {focal && (
                <button type="button" onClick={() => setFocal(null)} className={LINK}>
                  Clear focal point
                </button>
              )}
            </div>
          </div>

          <div className="@container">
            <div className="grid grid-cols-1 @pair:grid-cols-2 gap-3 text-sm">
              <label>
                Title
                <input type="text" required value={title} onChange={(e) => setTitle(e.target.value)} className={`${INPUT} mt-1`} />
              </label>
              <label>
                Tags
                <input type="text" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hedgies-on-first, retreat" className={`${INPUT} mt-1`} />
              </label>
              <label className="@pair:col-span-2">
                Alt text (what it shows, for screen readers)
                <input type="text" value={alt} onChange={(e) => setAlt(e.target.value)} className={`${INPUT} mt-1`} />
              </label>
              <label className="flex items-center gap-2 @pair:col-span-2">
                <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
                Public: anyone with the link can see it, signed in or not
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1">How it looks</h3>
            <div className="flex gap-4 items-start">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route */}
                <img src={mediaSrc(assetId, "event_card", version)} alt="As an event card" className="w-48 aspect-video object-cover rounded border border-gray-200 dark:border-slate-700" />
                <figcaption className="text-xs text-slate-600 dark:text-slate-400">Event card</figcaption>
              </figure>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route */}
                <img src={mediaSrc(assetId, "book_cover_shelf", version)} alt="As a book cover" className="h-28 aspect-[290/430] object-cover rounded border border-gray-200 dark:border-slate-700" />
                <figcaption className="text-xs text-slate-600 dark:text-slate-400">Book cover</figcaption>
              </figure>
            </div>
            <label className="block text-sm mt-3">
              A picture that isn&apos;t cover-shaped
              <select value={coverFit} onChange={(e) => setCoverFit(e.target.value as FitMode)} className={`${INPUT} mt-1`}>
                {FIT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {FIT_LABELS[m]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1">Where it&apos;s used</h3>
            {usages.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">Nowhere yet.</p>
            ) : (
              <ul className="text-sm list-disc pl-5">
                {usages.map((u) => (
                  <li key={`${u.kind}-${u.id}`}>
                    {usageLink(u) ? (
                      <Link href={usageLink(u) as string} className={LINK}>
                        {u.title}
                      </Link>
                    ) : (
                      u.title
                    )}{" "}
                    <span className="text-slate-600 dark:text-slate-400">({u.kind})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-1">Download</h3>
            <div className="flex flex-wrap gap-4 text-sm mb-3">
              <a data-track="media-download-original" href={`/api/media/${assetId}/original?download=1`} onClick={() => track("media_downloaded", { kind: "original" })} className={LINK}>
                The original
              </a>
              <a data-track="media-download-kdp" href={`/api/media/${assetId}/book_cover_kdp_ebook?download=1`} onClick={() => track("media_downloaded", { kind: "kdp_ebook" })} className={LINK}>
                Amazon ebook cover (1600 x 2560 JPEG)
              </a>
            </div>
            <div className="flex flex-wrap gap-2 items-end text-sm">
              <label>
                Width
                <input type="number" min={1} max={8000} value={width} onChange={(e) => setWidth(e.target.value)} className={`${INPUT} mt-1 w-24`} />
              </label>
              <label>
                Height
                <input type="number" min={1} max={8000} value={height} onChange={(e) => setHeight(e.target.value)} className={`${INPUT} mt-1 w-24`} />
              </label>
              <label>
                Format
                <select value={format} onChange={(e) => setFormat(e.target.value)} className={`${INPUT} mt-1`}>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                  <option value="webp">WebP</option>
                </select>
              </label>
              <label>
                Fit
                <select value={customFit} onChange={(e) => setCustomFit(e.target.value as FitMode)} className={`${INPUT} mt-1`}>
                  {FIT_MODES.map((m) => (
                    <option key={m} value={m}>
                      {FIT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </label>
              <a data-track="media-download-custom" href={customHref} onClick={() => track("media_downloaded", { kind: "custom" })} className={`${SECONDARY} inline-block`}>
                Download this size
              </a>
            </div>
          </div>

          <div className="flex gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <button type="submit" disabled={busy || !title.trim()} className={PRIMARY}>
              {busy ? "Saving..." : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={onClose} className={SECONDARY}>
              Close
            </button>
            {confirmingDelete ? (
              <span className="ml-auto flex gap-2 items-center text-sm">
                Delete this image?
                <button type="button" disabled={busy} onClick={() => void remove()} className={`${BUTTON} bg-red-700 text-white hover:bg-red-800 disabled:opacity-50`}>
                  Yes, delete
                </button>
                <button type="button" onClick={() => setConfirmingDelete(false)} className={SECONDARY}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmingDelete(true)} className={`${BUTTON} ml-auto text-red-700 dark:text-red-400 hover:underline disabled:opacity-50`}>
                Delete
              </button>
            )}
          </div>
        </form>
      )}
    </Modal>
  );
}
