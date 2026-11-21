import AmazonCoverDownload from "@/components/media/AmazonCoverDownload";
import { coverAssetIdOf, describeBookCoverRequirements } from "@/lib/bookCover";

/** The library image behind a cover, with its size. */
export interface CoverAsset {
  id: string;
  width: number;
  height: number;
}

/**
 * What goes under a book's cover control: what a cover may be, the picture's size and the Amazon download. The size
 * and download show only when `asset` is the image the cover URL points at (a project's cover is a URL until its size
 * is known).
 */
export default function BookCoverDetails({ url, asset, hint }: { url: string; asset: CoverAsset | null; hint?: string }) {
  const known = asset && coverAssetIdOf(url) === asset.id ? asset : null;
  return (
    <>
      <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">{describeBookCoverRequirements()}</p>
      {hint && <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{hint}</p>}
      {known && (
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          {known.width} x {known.height} px. <AmazonCoverDownload asset={known} />
        </p>
      )}
    </>
  );
}
