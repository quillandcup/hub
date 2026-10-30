"use client";

import { useState } from "react";
import MediaEditor from "@/components/media/MediaEditor";
import Modal from "@/components/Modal";
import { useMediaSearch } from "@/components/media/useMediaSearch";
import { track } from "@/lib/analytics/client";
import { amazonCoverHref, amazonCoverProblem, bookCoverUrlFor, BOOK_COVER_MAX_BYTES, coverAssetIdOf, describeBookCoverRequirements } from "@/lib/bookCover";
import { mediaSrc } from "@/lib/media/url";

/** The library image behind a cover, with its size. */
export interface CoverAsset {
  id: string;
  width: number;
  height: number;
}

const BUTTON = "px-3 py-1.5 rounded-lg text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-50";
const OWN_IMAGES = "/api/bookshelf/cover";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,.heic";

/**
 * A book's cover: a preview, a file picker that takes any size (the Hub makes the Bookshelf and Amazon sizes), the
 * member's earlier images to choose from, "Adjust crop" (the media editor: focal point and how a picture of another
 * shape fits), and, for a cover in the media library that is big enough, a "Download for Amazon" link. `onUploaded` is
 * told about a new or chosen cover and answers an error message to show, or nothing when it took it.
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
  const [uploading, setUploading] = useState(false);
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

  async function choose(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file after a failed attempt
    if (!file) return;
    setError(null);
    if (file.size > BOOK_COVER_MAX_BYTES) {
      setError(`Cover must be under ${BOOK_COVER_MAX_BYTES / (1024 * 1024)} MB`);
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/bookshelf/cover", { method: "POST", body });
      const json = await res.json();
      if (!res.ok) {
        track("media_uploaded", { surface: "book_cover", ok: false, converted: false, duplicate: false, large: false });
        setError(json.error ?? "Upload failed, try again");
        return;
      }
      track("media_uploaded", { surface: "book_cover", ok: true, converted: json.convertedFrom === "heic", duplicate: !!json.duplicate, large: false });
      await adopt({ url: json.url, asset: { id: json.assetId, width: json.width, height: json.height } });
    } catch {
      track("media_uploaded", { surface: "book_cover", ok: false, converted: false, duplicate: false, large: false });
      setError("Upload failed, try again");
    } finally {
      setUploading(false);
    }
  }

  const ownCover = !!asset && coverAssetIdOf(url) === asset.id;
  const amazonProblem = asset && coverAssetIdOf(url) === asset.id ? amazonCoverProblem(asset) : undefined;

  return (
    <div className="flex items-start gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={ownCover && version ? mediaSrc(asset.id, "book_cover_shelf", version) : url} alt="Cover preview" className="w-16 h-24 object-cover rounded border border-slate-200 dark:border-slate-700 flex-shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <input
          type="file"
          accept={ACCEPT}
          aria-label="Cover image file"
          onChange={choose}
          disabled={uploading}
          className="block w-full text-sm text-slate-600 dark:text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-slate-100 dark:file:bg-slate-800 file:text-slate-700 dark:file:text-slate-300 hover:file:bg-slate-200 dark:hover:file:bg-slate-700"
        />
        <div className="flex flex-wrap gap-2 mt-2">
          <button type="button" data-track="book-cover-choose" disabled={uploading} onClick={() => setChoosing(true)} className={BUTTON}>
            My images
          </button>
          {ownCover && (
            <button type="button" data-track="book-cover-adjust" disabled={uploading} onClick={() => setAdjusting(true)} className={BUTTON}>
              Adjust crop
            </button>
          )}
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{uploading ? "Uploading..." : describeBookCoverRequirements()}</p>
        {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
        {asset && coverAssetIdOf(url) === asset.id && (
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            {asset.width} x {asset.height} px.{" "}
            {amazonProblem === null ? (
              <a
                href={amazonCoverHref(asset.id)}
                data-track="book-cover-amazon"
                onClick={() => track("media_downloaded", { kind: "kdp_ebook" })}
                className="text-plum-600 dark:text-plum-400 hover:underline"
              >
                Download for Amazon (1600 x 2560 JPEG)
              </a>
            ) : (
              amazonProblem
            )}
          </p>
        )}
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400 mt-1">{error}</p>}
      </div>
      <Modal isOpen={choosing} onClose={() => setChoosing(false)} title="Choose from your images" maxWidth="2xl">
        <OwnImages
          onPick={async (image) => {
            track("media_picked", { surface: "book_cover", from: "library", searched: image.searched });
            setChoosing(false);
            if (image.width === undefined || image.height === undefined) return setError("Couldn't use that image");
            setError(null);
            await adopt({ url: bookCoverUrlFor(image.id), asset: { id: image.id, width: image.width, height: image.height } });
          }}
        />
      </Modal>
      {adjusting && ownCover && <MediaEditor own assetId={asset.id} onClose={() => setAdjusting(false)} onChanged={() => setVersion(String(Date.now()))} />}
    </div>
  );
}

/** The member's earlier uploads, to use one again. */
function OwnImages({ onPick }: { onPick: (image: { id: string; width?: number; height?: number; searched: boolean }) => void }) {
  const { q, searched, setQ, assets, more, loading, error, loadMore } = useMediaSearch(OWN_IMAGES);
  return (
    <div>
      <input
        type="search"
        aria-label="Search your images by title"
        placeholder="Search by title"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full px-3 py-2 mb-3 border border-gray-300 dark:border-slate-700 dark:bg-slate-900 dark:text-gray-100 rounded text-sm"
      />
      {error && <p role="alert" className="mb-3 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {assets.length === 0 && !loading && !error ? (
        <p className="text-sm text-slate-600 dark:text-slate-400">{q ? "Nothing matches." : "No images yet. Upload a cover and it will be here next time."}</p>
      ) : (
        <div className="@container">
          <ul className="grid grid-cols-3 @pair:grid-cols-4 gap-3">
            {assets.map((a) => (
              <li key={a.id}>
                <button type="button" data-track="book-cover-pick" onClick={() => onPick({ id: a.id, width: a.width, height: a.height, searched })} className="block w-full text-left group">
                  {/* eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset */}
                  <img src={mediaSrc(a.id, "book_cover_shelf", a.updated_at)} alt={a.title} loading="lazy" className="w-full aspect-[290/430] object-cover rounded border border-gray-200 dark:border-slate-700 group-hover:ring-2 group-hover:ring-plum-500" />
                  <span className="block mt-1 text-xs truncate">{a.title}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {loading && <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Loading...</p>}
      {more && !loading && (
        <button type="button" onClick={() => void loadMore()} className={`${BUTTON} mt-3`}>
          Show more
        </button>
      )}
    </div>
  );
}
