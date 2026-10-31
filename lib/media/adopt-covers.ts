import type { SupabaseClient } from "@supabase/supabase-js";
import { amazonCoverProblem, bookCoverUrlFor, coverAssetIdOf } from "@/lib/bookCover";
import type { BookRepository } from "@/lib/data/books";
import type { MediaRepository } from "@/lib/data/media";
import type { WritingRepository } from "@/lib/data/writing";
import { fetchLegacyCover, type FetchedCover } from "./fetch-cover";
import { inspectImage } from "./inspect";
import { storeImage } from "./library";

/** A book or project whose cover is still a link (an outside link, or a file in the old book-covers bucket). */
export interface LegacyCover {
  kind: "book" | "project";
  id: string;
  memberId: string;
  title: string;
  url: string;
}

export interface AdoptReport {
  /** True when nothing was written. */
  dryRun: boolean;
  considered: number;
  /** Moved into the library (or, in a dry run, would be). */
  adopted: number;
  /** How many of those came from a file in the old book-covers bucket, and how many from an outside link. */
  fromOwnBucket: number;
  fromLinks: number;
  /** Of the adopted, how many are big enough to become an Amazon cover as they are, and how many are too small. */
  amazonReady: number;
  tooSmallForAmazon: number;
  /** Covers that couldn't be moved, with the id of the book or project and why; they stay as they were. */
  failed: { kind: "book" | "project"; id: string; reason: string }[];
}

export interface AdoptDeps {
  media: MediaRepository;
  writing: WritingRepository;
  books: Pick<BookRepository, "withoutCoverAsset" | "adoptCover">;
  /** Service role. */
  storage: SupabaseClient["storage"];
  supabaseUrl: string;
  fetchCover?: (storage: SupabaseClient["storage"], supabaseUrl: string, url: string) => Promise<FetchedCover>;
  onProgress?: (done: number, total: number) => void;
}

/**
 * Moves older covers into the media library as their member's own image, so the new Bookshelf size and the Amazon
 * download work for them (as far as their size allows: a 145 x 215 cover can't be made an Amazon cover, but a
 * cover that was a link to a bigger picture can). Each book or project is pointed at the new image only if its cover
 * hasn't changed meanwhile; the old file in the book-covers bucket is left where it is. Safe to run again: what
 * was moved is not looked at, and the same picture twice is one image. Without `apply` it reads and reports only.
 */
export async function adoptLegacyCovers(deps: AdoptDeps, { apply }: { apply: boolean }): Promise<AdoptReport> {
  const fetchCover = deps.fetchCover ?? fetchLegacyCover;
  const projects = await deps.writing.projectsWithLegacyCovers();
  const covers: LegacyCover[] = [
    ...(await deps.books.withoutCoverAsset())
      .filter((b) => !coverAssetIdOf(b.cover_url))
      .map((b) => ({ kind: "book" as const, id: b.id, memberId: b.member_id, title: b.title, url: b.cover_url })),
    ...projects.filter((p) => !coverAssetIdOf(p.cover_url)).map((p) => ({ kind: "project" as const, id: p.id, memberId: p.member_id, title: p.title, url: p.cover_url })),
  ];
  const report: AdoptReport = { dryRun: !apply, considered: covers.length, adopted: 0, fromOwnBucket: 0, fromLinks: 0, amazonReady: 0, tooSmallForAmazon: 0, failed: [] };
  const fail = (c: LegacyCover, reason: string) => report.failed.push({ kind: c.kind, id: c.id, reason });
  const ownPrefix = `${deps.supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/book-covers/`;

  for (const [index, cover] of covers.entries()) {
    deps.onProgress?.(index + 1, covers.length);
    try {
      const fetched = await fetchCover(deps.storage, deps.supabaseUrl, cover.url);
      if ("error" in fetched) {
        fail(cover, fetched.error);
        continue;
      }
      let size: { width: number; height: number } | null = null;
      if (apply) {
        const stored = await storeImage(deps.media, deps.storage, { bytes: fetched.bytes, title: cover.title, ownerMemberId: cover.memberId });
        if (!stored.ok) {
          fail(cover, stored.error);
          continue;
        }
        let moved = true;
        if (cover.kind === "book") moved = await deps.books.adoptCover(cover.id, cover.url, { url: bookCoverUrlFor(stored.asset.id), assetId: stored.asset.id });
        else await deps.writing.updateProject(cover.memberId, cover.id, { cover_url: bookCoverUrlFor(stored.asset.id), cover_asset_id: stored.asset.id });
        if (!moved) {
          fail(cover, "its cover changed while this ran; left as it is");
          continue;
        }
        size = { width: stored.asset.width, height: stored.asset.height };
      } else {
        const inspected = await inspectImage(fetched.bytes);
        if (!inspected.ok && !inspected.heic) {
          fail(cover, inspected.error);
          continue;
        }
        if (inspected.ok) size = { width: inspected.width, height: inspected.height };
      }
      report.adopted++;
      if (cover.url.startsWith(ownPrefix)) report.fromOwnBucket++;
      else report.fromLinks++;
      if (size) {
        if (amazonCoverProblem(size) === null) report.amazonReady++;
        else report.tooSmallForAmazon++;
      }
    } catch (error) {
      fail(cover, error instanceof Error ? error.message : String(error));
    }
  }
  return report;
}
