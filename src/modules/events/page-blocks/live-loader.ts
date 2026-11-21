import { logLiveFailure, type PageDataLoader } from "@/lib/landing/live-data";
import { blocksOf } from "@/lib/landing/walk";
import { comingUpCards, comingUpKey, comingUpOptions, type ComingUpOptions, type ComingUpSnapshot } from "./live-events";
import { scheduleOptions, scheduleRows, stripText, zoneNote, type ScheduleSnapshot } from "./live-schedule";

/**
 * The events integration's live data loader: what the Schedule panel, the Announcement strip and Coming up get in their
 * render-only `live` prop (docs/product/LANDING_PAGES.md, "Live data"):
 *
 * - Schedule panel (`source` "live"): `live: { rows, zoneLabel }`.
 * - Announcement strip (`source` "live"): `live: { text }`, "" when nothing is coming up.
 * - Coming up (`source` "live"): `live: { cards }`, the next events announced publicly; no `live` when there are none.
 */

export const EVENT_BLOCK_TYPES = ["SchedulePanel", "AnnouncementStrip", "ComingUp"] as const;

export type EventsLoaders = {
  schedule: () => Promise<ScheduleSnapshot>;
  /** The next announced events for one block's options (`comingUpOptions`). */
  comingUp: (options: ComingUpOptions) => Promise<ComingUpSnapshot>;
};

const isLive = (props: Record<string, unknown>) => props.source === "live";

/** What a page asks of the events data, so a page with only typed blocks costs nothing. */
export function neededEventData(page: unknown): { schedule: boolean; comingUp: ComingUpOptions[] } {
  const comingUp = new Map<string, ComingUpOptions>();
  let schedule = false;
  for (const block of blocksOf(page)) {
    if ((block.type === "SchedulePanel" || block.type === "AnnouncementStrip") && isLive(block.props)) schedule = true;
    if (block.type === "ComingUp" && isLive(block.props)) {
      const options = comingUpOptions(block.props);
      comingUp.set(comingUpKey(options), options);
    }
  }
  return { schedule, comingUp: [...comingUp.values()] };
}

export function createEventsLoader(loaders: EventsLoaders): PageDataLoader {
  return {
    id: "events",
    types: EVENT_BLOCK_TYPES,
    async load(page, nowDate) {
      const needs = neededEventData(page);
      if (!needs.schedule && needs.comingUp.length === 0) return null;
      const [schedule, comingUp] = await Promise.all([
        needs.schedule ? loaders.schedule().catch((e) => logLiveFailure("schedule", e)) : Promise.resolve(null),
        Promise.all(needs.comingUp.map(async (options) => [comingUpKey(options), await loaders.comingUp(options).catch((e) => logLiveFailure("coming_up", e))] as const)).then((pairs) => new Map(pairs)),
      ]);
      return ({ type, props }) => {
        if (type === "ComingUp") {
          const options = comingUpOptions(props);
          const snapshot = isLive(props) ? comingUp.get(comingUpKey(options)) : null;
          if (!snapshot) return undefined;
          const cards = comingUpCards(snapshot, nowDate, options);
          return cards.length > 0 ? { ...props, live: { cards } } : undefined;
        }
        if (!isLive(props) || !schedule) return undefined;
        if (type === "SchedulePanel") return { ...props, live: { rows: scheduleRows(schedule, nowDate, scheduleOptions(props)), zoneLabel: `Times in ${zoneNote(nowDate.getTime())}` } };
        if (type === "AnnouncementStrip") return { ...props, live: { text: stripText(schedule, nowDate) } };
        return undefined;
      };
    },
  };
}
