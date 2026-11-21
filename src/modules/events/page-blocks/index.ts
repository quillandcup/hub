import { definePageBlock, type PageBlockContribution } from "@/components/landing/block-registry";
import { AnnouncementStrip, ComingUp, SCHEDULE_ITEM_LIMIT, ScheduleRowItem, SchedulePanel } from "./blocks";
import { COMING_UP_LIST_HEADING } from "./live-kinds";

/**
 * The events integration's contribution to the page builder (the render side, safe for the server and the browser): four blocks about
 * what is on, named the way pages already store them (`type` is never renamed). Their editor fields are `editor.tsx`, their live data
 * loader `server.ts`; the composition root (`src/modules/`) lists all three. Without this module installed, a stored page that uses
 * these blocks still renders (they draw nothing) and still opens in the editor (a placeholder stands in for each).
 */

/** A child block as it is stored in a parent's slot: `{ type, props }`. Puck gives it an id when the parent is added. */
const kid = (type: string, props: Record<string, unknown>) => ({ type, props: { ...props } });

export const EVENT_BLOCK_DEFAULTS = {
  // Typed by hand, or live ("source"; docs/product/LANDING_PAGES.md, "Live data"). A block dropped on a page now starts live (its point is to be live), with the typed values as the fallback; a block saved without `source` stays typed.
  AnnouncementStrip: { text: "Your next prickle starts soon", buttonLabel: "Drop in", href: "", tone: "gold", source: "live", whenNone: "hide" },
  SchedulePanel: {
    title: "Writing right now",
    zoneLabel: "",
    source: "live",
    hoursAhead: 24,
    maxRows: 5,
    hostStyle: "none",
    experiencedHostText: "An experienced host, sure to make you feel at home",
    openLabel: "",
    rowNote: "",
    footer: "",
    emptyText: "No sessions are coming up just yet. Check back soon.",
    items: [
      kid("ScheduleRow", { time: "9:00 am", title: "Morning pages", status: "Live", state: "live", host: "" }),
      kid("ScheduleRow", { time: "10:00 am", title: "Focus hour", status: "In 42 min", state: "soon", host: "" }),
      kid("ScheduleRow", { time: "12:30 pm", title: "Lunch hour", status: "Camera optional", state: "open", host: "" }),
    ],
  },
  ScheduleRow: { time: "", title: "New session", status: "", state: "open", host: "" },
  ComingUp: {
    heading: "Coming up",
    style: "cards",
    source: "live",
    kinds: ["in_person_retreat", "virtual_retreat", "workshop"],
    max: 4,
    more: { label: "", href: "" },
    waitlist: { label: "Join the waitlist", href: "" },
    items: [{ kind: "Retreat", title: "Name", when: "Dates and place", availability: "Spots left", status: "", linkLabel: "", href: "" }],
  },
} as const;

export const eventsPageBlocks: PageBlockContribution = {
  id: "events",
  blocks: [
    definePageBlock({ type: "AnnouncementStrip", label: "Announcement strip", category: "homepage", order: 10, defaults: EVENT_BLOCK_DEFAULTS.AnnouncementStrip, render: AnnouncementStrip, publishCheck: (p, { checkButton }) => checkButton("Announcement strip", p.buttonLabel, p.href) }),
    definePageBlock({
      type: "SchedulePanel",
      label: "Schedule panel",
      category: "homepage",
      order: 20,
      defaults: EVENT_BLOCK_DEFAULTS.SchedulePanel,
      render: SchedulePanel,
      slots: { items: { allow: ["ScheduleRow"] } },
      itemLimit: SCHEDULE_ITEM_LIMIT,
      // A live panel falls back to its typed sessions only when the live read fails, so having none is not worth a warning there.
      itemRule: { block: "Schedule panel", noun: "session", plural: "sessions", item: "ScheduleRow", key: "title", liveOk: true },
    }),
    definePageBlock({ type: "ScheduleRow", label: "Session", category: "parts", order: 140, defaults: EVENT_BLOCK_DEFAULTS.ScheduleRow, render: ScheduleRowItem }),
    definePageBlock({
      type: "ComingUp",
      label: "Coming up",
      category: "homepage",
      order: 100,
      defaults: EVENT_BLOCK_DEFAULTS.ComingUp,
      render: ComingUp,
      publishCheck: (p, { str, rows, heading: addHeading, checkButton }) => {
        // The same heading the block draws: a list never given one says "Upcoming sessions" (src/modules/events/page-blocks/blocks.tsx).
        const heading = p.heading === undefined && p.style === "list" ? COMING_UP_LIST_HEADING : str(p.heading);
        if (heading) addHeading(3, heading);
        for (const [i, card] of rows(p.items).entries()) {
          if (str(card.title)) addHeading(heading ? 4 : 3, str(card.title));
          checkButton("Coming up", card.linkLabel, card.href, `Card ${i + 1}'s link`);
        }
      },
    }),
  ],
};
