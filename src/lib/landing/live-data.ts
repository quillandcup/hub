import { normalizeLandingData } from "./data";
import { mapBlocks, type StoredBlock } from "./walk";

/**
 * Live values for the blocks that can have them (docs/product/LANDING_PAGES.md, "Live data"). Blocks are presentational, so the
 * server resolves what they need before the render and hands it to them in a render-only prop named `live`. What a block gets
 * is the business of the loader that serves it (the core one for Outcome numbers is in `live-stats-loader.ts`; the events
 * integration brings its own, docs/architecture/PAGE_BLOCKS.md): this file is only the plumbing they share.
 *
 * Nothing is written back: the document the page was stored with is never changed (the result is a copy for one render),
 * and a `live` prop found in stored data is dropped from every block a loader serves, so it can't be planted. A block with no live
 * data (the load failed, or there was nothing to show) gets no `live` and renders its typed values.
 */

/** Gives one block its live props, or `undefined` to leave it as it is. */
export type LiveBlockApplier = (block: StoredBlock) => Record<string, unknown> | undefined;

export type PageDataLoader = {
  /** For logs only: a short code for this loader's failures. */
  id: string;
  /** The block types this loader serves: a stored `live` prop on these is dropped before anything else. */
  types: readonly string[];
  /** Reads what this page needs (nothing, for a page with no live blocks of its own) and returns how to apply it, or null when there is nothing to apply. A throw means "typed values". */
  load: (page: unknown, now: Date) => Promise<LiveBlockApplier | null>;
};

const withoutLive = ({ live: _live, ...rest }: Record<string, unknown>) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

/** A short code and the kind of error only: no data, nothing a member wrote. */
export const logLiveFailure = (code: string, error: unknown): null => {
  console.error(`landing_live_${code}_failed`, error instanceof Error ? error.name : "error");
  return null;
};

/** The page with live values injected for one render. Any loader error is logged by code and means "typed values", never an error on the page. */
export async function resolveLiveBlocks(data: unknown, loaders: readonly PageDataLoader[], nowDate: Date = new Date()): Promise<unknown> {
  const served = new Set(loaders.flatMap((l) => l.types));
  const clean = mapBlocks(normalizeLandingData(data), (block) => (served.has(block.type) ? withoutLive(block.props) : block.props));
  const appliers = (await Promise.all(loaders.map((l) => l.load(clean, nowDate).catch((e) => logLiveFailure(l.id, e))))).filter((a): a is LiveBlockApplier => a !== null);
  if (appliers.length === 0) return clean;
  return mapBlocks(clean, (block) => {
    let props = block.props;
    for (const apply of appliers) props = apply({ type: block.type, props }) ?? props;
    return props;
  });
}
