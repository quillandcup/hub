import type { EventName } from "@/lib/analytics/events";

/** The windows the usage page offers, in days. */
export const WINDOW_DAYS = [7, 30, 90] as const;

export function parseWindowDays(value: string | string[] | undefined): number {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (WINDOW_DAYS as readonly number[]).includes(n) ? n : 30;
}

export interface FunnelDefinition {
  title: string;
  description: string;
  /** `where` limits a step to events with these property values. */
  steps: { event: EventName; label: string; where?: Record<string, boolean | number | string> }[];
}

/**
 * Funnels shown on the usage page (/admin/analytics): an ordered list of events, counted per
 * visit. Add one when a feature ships, next to the events it logs.
 */
export const FUNNELS: FunnelDefinition[] = [
  {
    title: "On air light: someone is at the table",
    description: "Visits that opened the popover while the room was live, then clicked Join on Zoom.",
    steps: [
      { event: "onair_popover_opened", label: "Opened the popover", where: { live: true } },
      { event: "onair_join_clicked", label: "Clicked Join on Zoom", where: { live: true } },
    ],
  },
  {
    title: "On air light: off air",
    description:
      "Visits that opened the popover while the room was empty, then clicked Start a PUP on Zoom. A big drop here is the case for showing the next scheduled prickle instead.",
    steps: [
      { event: "onair_popover_opened", label: "Opened the popover", where: { live: false } },
      { event: "onair_join_clicked", label: "Clicked Start a PUP on Zoom", where: { live: false } },
    ],
  },
];
