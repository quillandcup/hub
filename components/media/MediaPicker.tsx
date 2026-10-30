"use client";

import { useState } from "react";
import Modal from "@/components/Modal";
import { track } from "@/lib/analytics/client";
import type { PresetName } from "@/lib/media/presets";
import { mediaSrc } from "@/lib/media/url";
import type { MediaSurface } from "@/lib/media/surfaces";
import MediaUploadForm from "./MediaUploadForm";
import { useMediaSearch } from "./useMediaSearch";

type Surface = MediaSurface;


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
  const { q, searched, setQ, assets, more, loading, error, setError, loadMore } = useMediaSearch();

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
            onChange={(e) => setQ(e.target.value)}
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
            <button type="button" onClick={() => void loadMore()} className={`${SECONDARY} mt-3`}>
              Show more
            </button>
          )}
        </div>
      ) : (
        <MediaUploadForm surface={surface} onUploaded={(id) => onPick(id, "upload", false)} onError={setError} />
      )}
    </div>
  );
}
