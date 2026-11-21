import { normalizeLandingData } from "./data";
import { isLiveStatKey, type LiveStatValue } from "./live-stats";
import { comingUpCards, comingUpKey, comingUpOptions, type ComingUpOptions, type ComingUpSnapshot } from "./live-events";
import { scheduleOptions, scheduleRows, stripText, zoneNote, type ScheduleSnapshot } from "./live-schedule";

/**
 * Live values for the blocks that can have them (docs/product/LANDING_PAGES.md, "Live data"). Blocks are presentational, so the
 * server resolves what they need before the render and hands it to them in a render-only prop named `live`:
 *
 * - Outcome numbers: per item (an `OutcomeNumber` block in its `items` slot, with `source` "live" and a `stat`), `live: { value, caption, note }` in the item's own props (`note` is the block's "show a live note" switch, which the item cannot see).
 * - Schedule panel (`source` "live"): `live: { rows, zoneLabel }`.
 * - Announcement strip (`source` "live"): `live: { text }`, "" when nothing is coming up.
 * - Coming up (`source` "live"): `live: { cards }`, the next events announced publicly; no `live` when there are none.
 *
 * Nothing is written back: the document the page was stored with is never changed (the result is a copy for one render),
 * and a `live` prop found in stored data is dropped, so it can't be planted. A block with no live data (the load failed,
 * or there was nothing to show) gets no `live` and renders its typed values.
 */

export type LiveLoaders = {
  /** The figures for these stat keys; a key with nothing to show is absent. */
  stats: (keys: string[]) => Promise<Record<string, LiveStatValue>>;
  schedule: () => Promise<ScheduleSnapshot>;
  /** The next announced events for one block's options (`comingUpOptions`). */
  comingUp: (options: ComingUpOptions) => Promise<ComingUpSnapshot>;
};

type Block = { type?: unknown; props?: Record<string, unknown> };
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isBlock = (v: unknown): v is Block & { type: string; props: Record<string, unknown> } => isObject(v) && typeof v.type === "string" && isObject(v.props);

/** Every block in a document, nested ones (slots) and zones included. */
function* blocksOf(value: unknown): Generator<Block & { type: string; props: Record<string, unknown> }> {
  if (Array.isArray(value)) for (const v of value) yield* blocksOf(v);
  else if (isObject(value)) {
    if (isBlock(value)) yield value;
    for (const v of Object.values(value)) yield* blocksOf(v);
  }
}

/** A copy of the document with `change` applied to each block of the named types. */
function mapBlocks(value: unknown, change: (block: Block & { type: string; props: Record<string, unknown> }) => Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => mapBlocks(v, change));
  if (!isObject(value)) return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapBlocks(v, change)]));
  return isBlock(mapped) ? { ...mapped, props: change(mapped) } : mapped;
}

const LIVE_TYPES = new Set(["OutcomeNumbers", "OutcomeNumber", "SchedulePanel", "AnnouncementStrip", "ComingUp"]);
const isLive = (props: Record<string, unknown>) => props.source === "live";
const withoutLive = ({ live: _live, ...rest }: Record<string, unknown>) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars

/** The figures of an Outcome numbers block are `OutcomeNumber` blocks in its `items` slot; their own props say what they show. */
const figuresOf = (props: Record<string, unknown>): (Block & { props: Record<string, unknown> })[] => (Array.isArray(props.items) ? props.items.filter((i): i is Block & { props: Record<string, unknown> } => isBlock(i)) : []);

const statKeysOf = (props: Record<string, unknown>): string[] => figuresOf(props).flatMap((i) => (i.props.source === "live" && isLiveStatKey(i.props.stat) ? [i.props.stat] : []));

/** Whether a page has anything to resolve, so a page with only typed blocks costs nothing. */
export function needsLiveData(data: unknown): { stats: string[]; schedule: boolean; comingUp: ComingUpOptions[] } {
  const stats = new Set<string>();
  const comingUp = new Map<string, ComingUpOptions>();
  let schedule = false;
  for (const block of blocksOf(data)) {
    if (block.type === "OutcomeNumbers") for (const key of statKeysOf(block.props)) stats.add(key);
    if ((block.type === "SchedulePanel" || block.type === "AnnouncementStrip") && isLive(block.props)) schedule = true;
    if (block.type === "ComingUp" && isLive(block.props)) {
      const options = comingUpOptions(block.props);
      comingUp.set(comingUpKey(options), options);
    }
  }
  return { stats: [...stats].sort(), schedule, comingUp: [...comingUp.values()] };
}

const failed = (code: string, error: unknown) => {
  // A short code and the kind of error only: no data, nothing a member wrote.
  console.error(`landing_live_${code}_failed`, error instanceof Error ? error.name : "error");
  return null;
};

/** The page with live values injected for one render. Any loader error is logged by code and means "typed values", never an error on the page. */
export async function resolveLiveBlocks(data: unknown, loaders: LiveLoaders, nowDate: Date = new Date()): Promise<unknown> {
  const page = normalizeLandingData(data);
  const needs = needsLiveData(page);
  const [stats, schedule, comingUp] = await Promise.all([
    needs.stats.length > 0 ? loaders.stats(needs.stats).catch((e) => failed("stats", e)) : Promise.resolve(null),
    needs.schedule ? loaders.schedule().catch((e) => failed("schedule", e)) : Promise.resolve(null),
    Promise.all(needs.comingUp.map(async (options) => [comingUpKey(options), await loaders.comingUp(options).catch((e) => failed("coming_up", e))] as const)).then((pairs) => new Map(pairs)),
  ]);
  return mapBlocks(page, (block) => {
    const props = withoutLive(block.props);
    if (!LIVE_TYPES.has(block.type)) return block.props;
    if (block.type === "OutcomeNumbers") {
      if (!Array.isArray(props.items)) return props;
      return {
        ...props,
        items: props.items.map((item) => {
          if (!isBlock(item)) return item;
          const plain = withoutLive(item.props);
          const figure = plain.source === "live" && isLiveStatKey(plain.stat) ? stats?.[plain.stat] : undefined;
          return { ...item, props: figure ? { ...plain, live: { value: figure.value, caption: figure.caption, note: props.showLiveNote !== false } } : plain };
        }),
      };
    }
    // A figure outside its block has nothing to show live: the block hands the figure to its items.
    if (block.type === "OutcomeNumber") return props;
    if (block.type === "ComingUp") {
      const options = comingUpOptions(props);
      const snapshot = isLive(props) ? comingUp.get(comingUpKey(options)) : null;
      if (!snapshot) return props;
      const cards = comingUpCards(snapshot, nowDate, options);
      return cards.length > 0 ? { ...props, live: { cards } } : props;
    }
    if (!isLive(props) || !schedule) return props;
    if (block.type === "SchedulePanel") {
      return { ...props, live: { rows: scheduleRows(schedule, nowDate, scheduleOptions(props)), zoneLabel: `Times in ${zoneNote(nowDate.getTime())}` } };
    }
    return { ...props, live: { text: stripText(schedule, nowDate) } };
  });
}
