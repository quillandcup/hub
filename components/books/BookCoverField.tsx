"use client";

import { useState } from "react";
import { track } from "@/lib/analytics/client";
import { amazonCoverHref, amazonCoverProblem, BOOK_COVER_MAX_BYTES, coverAssetIdOf, describeBookCoverRequirements } from "@/lib/bookCover";

/** The library image behind a cover, with its size. */
export interface CoverAsset {
  id: string;
  width: number;
  height: number;
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif,image/heic,.heic";

/**
 * A book's cover: a preview, a file picker that takes any size (the Hub makes the Bookshelf and Amazon sizes), and,
 * for a cover in the media library that is big enough, a "Download for Amazon" link. `onUploaded` is told about the new
 * cover and answers an error message to show, or nothing when it took it.
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
      const problem = await onUploaded({ url: json.url, asset: { id: json.assetId, width: json.width, height: json.height } });
      if (problem) setError(problem);
    } catch {
      track("media_uploaded", { surface: "book_cover", ok: false, converted: false, duplicate: false, large: false });
      setError("Upload failed, try again");
    } finally {
      setUploading(false);
    }
  }

  const amazonProblem = asset && coverAssetIdOf(url) === asset.id ? amazonCoverProblem(asset) : undefined;

  return (
    <div className="flex items-start gap-3">
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- served by the media route, already sized by its preset
        <img src={url} alt="Cover preview" className="w-16 h-24 object-cover rounded border border-slate-200 dark:border-slate-700 flex-shrink-0" />
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
    </div>
  );
}
