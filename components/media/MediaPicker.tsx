"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import type { PresetName } from "@/lib/media/presets";
import { mediaSrc } from "@/lib/media/url";
import type { MediaSurface } from "@/lib/media/surfaces";
import MediaEditor from "./MediaEditor";
import MediaUploadForm from "./MediaUploadForm";
import { useMediaSearch } from "./useMediaSearch";

type Surface = MediaSurface;


/** The photos of the event being edited, offered as a third place to pick from. */
export interface EventPhotos {
  eventId: string;
  photos: { id: string }[];
}

type PickSource = "library" | "upload" | "event_photo";

/** The picked image's size, when the chooser knows it (a member's own images and uploads always do). */
export type PickedAsset = { id: string; width: number; height: number };

const OWN_IMAGES = "/api/bookshelf/cover";

const BUTTON = "px-3 py-1.5 rounded text-sm";
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
  eventPhotos,
}: {
  value: string | null;
  onChange: (assetId: string | null) => void;
  surface: Surface;
  preview?: PresetName;
  disabled?: boolean;
  eventPhotos?: EventPhotos;
}) {
  const [open, setOpen] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [version, setVersion] = useState<string | undefined>();

  function choose(id: string, from: PickSource, searched: boolean) {
    track("media_picked", { surface, from, searched });
    onChange(id);
    setOpen(false);
    // A new upload opens the editor straight away, to set its focal point before it's used.
    setAdjusting(from === "upload");
  }

  return (
    <div>
      {value ? (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={mediaSrc(value, preview, version)} alt="The chosen image" className="w-full max-w-xs aspect-video object-cover rounded border border-gray-200 dark:border-slate-700" />
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
          <button type="button" data-track="media-picker-adjust" disabled={disabled} onClick={() => setAdjusting(true)} className={SECONDARY}>
            Adjust crop
          </button>
        )}
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
        <MediaChooser surface={surface} onPick={choose} eventPhotos={eventPhotos} />
      </Modal>
      {adjusting && value && <MediaEditor assetId={value} onClose={() => setAdjusting(false)} onChanged={() => setVersion(String(Date.now()))} />}
    </div>
  );
}

const TAB_LABELS = { library: "Library", upload: "Upload", photos: "Event photos" } as const;

/**
 * The chooser itself: the library (search, pick) and an upload tab, plus the event's own photos when it has some. With
 * `own` it is a member's chooser over just their own images, uploaded as book covers; the staff library and the
 * event photos are not in it.
 */
export function MediaChooser({
  surface,
  onPick,
  eventPhotos,
  own = false,
}: {
  surface: Surface;
  onPick: (id: string, from: PickSource, searched: boolean, asset?: PickedAsset) => void;
  eventPhotos?: EventPhotos;
  own?: boolean;
}) {
  const [tab, setTab] = useState<keyof typeof TAB_LABELS>("library");
  const [copying, setCopying] = useState(false);
  const hasPhotos = !own && !!eventPhotos && eventPhotos.photos.length > 0;
  const tabs = (hasPhotos ? ["library", "upload", "photos"] : ["library", "upload"]) as (keyof typeof TAB_LABELS)[];

  async function copyPhoto(photoId: string) {
    if (!eventPhotos) return;
    setCopying(true);
    setError(null);
    try {
      const response = await fetch("/api/media/from-event-photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: eventPhotos.eventId, photoId }) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Couldn't use that photo");
      onPick(body.asset.id, "event_photo", false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCopying(false);
    }
  }

  const { q, searched, setQ, assets, more, loading, error, setError, loadMore } = useMediaSearch(own ? OWN_IMAGES : undefined);

  return (
    <div>
      <div role="tablist" className="flex gap-4 border-b border-slate-200 dark:border-slate-800 mb-4">
        {tabs.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm -mb-px border-b-2 ${tab === t ? "border-plum-600 text-plum-700 dark:text-plum-300 font-medium" : "border-transparent text-slate-600 dark:text-slate-400"}`}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {error && <p role="alert" className="mb-3 p-3 rounded text-sm bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300">{error}</p>}

      {tab === "library" ? (
        <div>
          <input
            type="search"
            aria-label={own ? "Search your images by title" : "Search the library by title or tag"}
            placeholder={own ? "Search by title" : "Search by title or tag"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className={`${INPUT} mb-3`}
          />
          {assets.length === 0 && !loading && !error ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              {q ? "Nothing matches." : own ? "No images yet. Upload a cover and it will be here next time." : "No images yet."}{" "}
              <button type="button" onClick={() => setTab("upload")} className="text-plum-600 dark:text-plum-400 hover:underline">
                Upload one
              </button>
            </p>
          ) : (
            <div className="@container">
              <ul className="grid grid-cols-2 @pair:grid-cols-3 gap-3">
                {assets.map((a) => (
                  <li key={a.id}>
                    <button type="button" data-track="media-picker-choose" onClick={() => onPick(a.id, "library", searched, a.width !== undefined && a.height !== undefined ? { id: a.id, width: a.width, height: a.height } : undefined)} className="block w-full text-left group">
                      {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset */}
                      <img src={mediaSrc(a.id, own ? "book_cover_shelf" : "thumb", own ? a.updated_at : undefined)} alt={a.alt_text ?? (own ? a.title : "")} loading="lazy" className={`w-full ${own ? "aspect-[290/430]" : "aspect-square"} object-cover rounded border border-gray-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-plum-500`} />
                      <span className="block mt-1 text-xs truncate">{a.title}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {loading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Loading...</p>}
          {more && !loading && (
            <button type="button" onClick={() => void loadMore()} className={`${SECONDARY} mt-3`}>
              Show more
            </button>
          )}
        </div>
      ) : tab === "photos" && eventPhotos ? (
        <div className="@container">
          <p className="text-sm mb-3">Photos from this event. The one you pick is copied into the library; the gallery stays as it is.</p>
          <ul className="grid grid-cols-2 @pair:grid-cols-3 gap-3">
            {eventPhotos.photos.map((p) => (
              <li key={p.id}>
                <button type="button" data-track="media-picker-event-photo" disabled={copying} onClick={() => void copyPhoto(p.id)} className="block w-full group disabled:opacity-50">
                  {/* eslint-disable-next-line @next/next/no-img-element -- the event's private photo proxy */}
                  <img src={`/api/events/${eventPhotos.eventId}/photos/${p.id}`} alt="An event photo" loading="lazy" className="w-full aspect-video object-cover rounded border border-gray-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-plum-500" />
                </button>
              </li>
            ))}
          </ul>
          {copying && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Copying...</p>}
        </div>
      ) : (
        <MediaUploadForm surface={surface} own={own} onUploaded={(id, asset) => onPick(id, "upload", false, asset)} onError={setError} />
      )}
    </div>
  );
}
