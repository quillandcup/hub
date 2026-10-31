"use client";

import { useState } from "react";
import AmazonCoverDownload from "@/components/media/AmazonCoverDownload";
import MediaEditor from "@/components/media/MediaEditor";
import Modal from "@/components/Modal";
import { MediaChooser } from "@/components/media/MediaPicker";
import { track } from "@/lib/analytics/client";
import { bookCoverUrlFor, coverAssetIdOf, describeBookCoverRequirements } from "@/lib/bookCover";
import { mediaSrc } from "@/lib/media/url";

/** The library image behind a cover, with its size. */
export interface CoverAsset {
  id: string;
  width: number;
  height: number;
}

const BUTTON = "px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50";

/**
 * A book's cover: a preview and one chooser, a modal over the member's own images where they pick an earlier one or
 * upload a new one of any size (the Hub makes the Bookshelf and Amazon sizes). "Adjust crop" opens the media editor
 * (focal point and how a picture of another shape fits), and a cover in the library that is big enough has a
 * "Download for Amazon" link. `onUploaded` is told about a new or chosen cover and answers an error message to show,
 * or nothing when it took it.
 */
export default function BookCoverField({
  url,
  asset,
  onUploaded,
  hint,
}: {
  url: string;
  asset: CoverAsset | null;
  onUploaded: (cover: { url: string; asset: CoverAsset }) => Promise<string | null | void> | string | null | void;
  hint?: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [version, setVersion] = useState<string | undefined>();

  /** Hands a new or chosen cover to the parent; opens the crop editor once it took it. */
  async function adopt(cover: { url: string; asset: CoverAsset }) {
    const problem = await onUploaded(cover);
    if (problem) setError(problem);
    else setAdjusting(true);
  }

  async function picked(from: "library" | "upload" | "event_photo", searched: boolean, image?: { id: string; width: number; height: number }) {
    track("media_picked", { surface: "book_cover", from, searched });
    setChoosing(false);
    if (!image) return setError("Couldn't use that image");
    setError(null);
    await adopt({ url: bookCoverUrlFor(image.id), asset: image });
  }

  const ownCover = !!asset && coverAssetIdOf(url) === asset.id;

  return (
    <div className="flex items-start gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={ownCover && version ? mediaSrc(asset.id, "book_cover_shelf", version) : url} alt="Cover preview" className="w-16 h-24 object-cover rounded border border-slate-200 dark:border-slate-700 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" data-track="book-cover-choose" onClick={() => setChoosing(true)} className={BUTTON}>
            {url ? "Change cover" : "Choose cover"}
          </button>
          {ownCover && (
            <button type="button" data-track="book-cover-adjust" onClick={() => setAdjusting(true)} className={BUTTON}>
              Adjust crop
            </button>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{describeBookCoverRequirements()}</p>
        {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
        {asset && coverAssetIdOf(url) === asset.id && (
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {asset.width} x {asset.height} px.{" "}
            <AmazonCoverDownload asset={asset} />
          </p>
        )}
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      </div>
      <Modal isOpen={choosing} onClose={() => setChoosing(false)} title="Choose a cover" maxWidth="2xl">
        <MediaChooser own surface="book_cover" onPick={(_id, from, searched, image) => void picked(from, searched, image)} />
      </Modal>
      {adjusting && ownCover && <MediaEditor own assetId={asset.id} onClose={() => setAdjusting(false)} onChanged={() => setVersion(String(Date.now()))} />}
    </div>
  );
}
