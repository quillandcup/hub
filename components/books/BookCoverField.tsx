"use client";

import AmazonCoverDownload from "@/components/media/AmazonCoverDownload";
import MediaPicker from "@/components/media/MediaPicker";
import { bookCoverUrlFor, coverAssetIdOf, describeBookCoverRequirements } from "@/lib/bookCover";

/** The library image behind a cover, with its size. */
export interface CoverAsset {
  id: string;
  width: number;
  height: number;
}

/**
 * A book's cover: the media picker over the member's own images (choose an earlier one or upload a new one of any
 * size, then adjust the crop; the Hub makes the Bookshelf and Amazon sizes from it), with the requirements, the
 * size and the Amazon download under it. `onUploaded` is told about a new or chosen cover and answers an error
 * message to show, or nothing when it took it.
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
  // An older cover is a link to somewhere else: shown, but there is nothing to adjust or download.
  const ownCover = asset && coverAssetIdOf(url) === asset.id ? asset : null;
  return (
    <MediaPicker
      own
      shape="cover"
      noun="cover"
      alt="Cover preview"
      surface="book_cover"
      preview="book_cover_shelf"
      removable={false}
      value={ownCover?.id ?? null}
      legacyUrl={ownCover ? undefined : url || undefined}
      onChange={(id, picked) => (id && picked ? onUploaded({ url: bookCoverUrlFor(id), asset: picked }) : undefined)}
    >
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{describeBookCoverRequirements()}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
      {ownCover && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          {ownCover.width} x {ownCover.height} px. <AmazonCoverDownload asset={ownCover} />
        </p>
      )}
    </MediaPicker>
  );
}
