import type { PageDataLoader } from "./live-data";
import { isLiveStatKey, type LiveStatValue } from "./live-stats";
import { blocksOf, isBlock, type StoredBlock } from "./walk";

/**
 * The core live data loader: the figures of an Outcome numbers block (`OutcomeNumbers`, with an `OutcomeNumber` block in its
 * `items` slot per figure, `source` "live" and a `stat`; docs/product/LANDING_PAGES.md, "Live data"). Each item gets
 * `live: { value, caption, note }` in its own props, where `note` is the block's "show a live note" switch, which the item
 * cannot see. A figure with nothing to show gets no `live` and keeps its typed value.
 */

export const STATS_BLOCK_TYPES = ["OutcomeNumbers", "OutcomeNumber"] as const;

/** The figures for these stat keys; a key with nothing to show is absent. */
export type LoadStats = (keys: string[]) => Promise<Record<string, LiveStatValue>>;

/** The figures of an Outcome numbers block are `OutcomeNumber` blocks in its `items` slot; their own props say what they show. */
const figuresOf = (props: Record<string, unknown>): StoredBlock[] => (Array.isArray(props.items) ? props.items.filter((i): i is StoredBlock => isBlock(i)) : []);

const statKeysOf = (props: Record<string, unknown>): string[] => figuresOf(props).flatMap((i) => (i.props.source === "live" && isLiveStatKey(i.props.stat) ? [i.props.stat] : []));

/** The stat keys a page asks for, sorted, so a page with only typed blocks costs nothing. */
export function neededStats(page: unknown): string[] {
  const stats = new Set<string>();
  for (const block of blocksOf(page)) if (block.type === "OutcomeNumbers") for (const key of statKeysOf(block.props)) stats.add(key);
  return [...stats].sort();
}

export function createStatsLoader(loadStats: LoadStats): PageDataLoader {
  return {
    id: "stats",
    types: STATS_BLOCK_TYPES,
    async load(page) {
      const keys = neededStats(page);
      if (keys.length === 0) return null;
      const stats = await loadStats(keys);
      return (block) => {
        if (block.type !== "OutcomeNumbers" || !Array.isArray(block.props.items)) return undefined;
        const props = block.props;
        return {
          ...props,
          items: (props.items as unknown[]).map((item) => {
            if (!isBlock(item)) return item;
            const figure = item.props.source === "live" && isLiveStatKey(item.props.stat) ? stats[item.props.stat] : undefined;
            return { ...item, props: figure ? { ...item.props, live: { value: figure.value, caption: figure.caption, note: props.showLiveNote !== false } } : item.props };
          }),
        };
      };
    },
  };
}
