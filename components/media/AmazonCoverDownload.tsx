"use client";

import { track } from "@/lib/analytics/client";
import { amazonCoverHref, amazonCoverProblem } from "@/lib/bookCover";

/**
 * The Amazon ebook version of an image, as a download link, or the reason there is none when the image is too small
 * to make one (the route would answer with a bare JSON error, so the link is not offered). The one place the two
 * are decided, for the book forms and the media editor alike.
 */
export default function AmazonCoverDownload({ asset, className }: { asset: { id: string; width: number; height: number }; className?: string }) {
  const problem = amazonCoverProblem(asset);
  if (problem) {
    return (
      <span data-testid="amazon-unavailable" className="text-slate-600 dark:text-slate-400">
        {problem}
      </span>
    );
  }
  return (
    <a
      href={amazonCoverHref(asset.id)}
      data-track="amazon-cover-download"
      onClick={() => track("media_downloaded", { kind: "kdp_ebook" })}
      className={className ?? "text-plum-600 dark:text-plum-400 hover:underline"}
    >
      Download for Amazon (1600 x 2560 JPEG)
    </a>
  );
}
