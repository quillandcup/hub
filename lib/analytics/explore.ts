import { EVENTS, isEventName, type EventName } from "@/lib/analytics/events";

/**
 * The usage explorer's question as a URL, so a view can be shared and bookmarked:
 *
 *   /admin/analytics/explore?days=30&step=onair_popover_opened:live=true&step=onair_join_clicked:live=true&breakdown=onair_join_clicked.live
 *
 * A `step` is an event name, optionally followed by `:` and `prop=value` filters joined by `,`
 * (values percent-encoded, so they can hold either). Everything is checked against the tracking
 * plan: an unknown event drops the step, and a filter on an undeclared property or with a value
 * of the wrong type is ignored, so a hand-edited URL can't ask for anything the log can't hold.
 */

export const MAX_STEPS = 6;
const MAX_TEXT_FILTER = 80;

type Value = boolean | number | string;

export interface ExploreStep {
  event: EventName;
  where: Record<string, Value>;
}

export interface Breakdown {
  event: EventName;
  property: string;
}

type PropSpec = { kind: "bool" | "int" | "enum" | "text"; values?: readonly string[] };

function specFor(event: EventName, property: string): PropSpec | null {
  const props = EVENTS[event] as Record<string, PropSpec>;
  return Object.hasOwn(props, property) ? props[property] : null;
}

/** A filter value read from text, as the property's own type; undefined when it can't be one. */
export function coerceFilterValue(spec: PropSpec, raw: string): Value | undefined {
  switch (spec.kind) {
    case "bool":
      return raw === "true" ? true : raw === "false" ? false : undefined;
    case "int":
      return /^\d{1,9}$/.test(raw) ? Number(raw) : undefined;
    case "enum":
      return spec.values?.includes(raw) ? raw : undefined;
    case "text":
      return raw.length > 0 && raw.length <= MAX_TEXT_FILTER ? raw : undefined;
  }
}

function decode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseStep(raw: string): ExploreStep | null {
  const colon = raw.indexOf(":");
  const event = colon === -1 ? raw : raw.slice(0, colon);
  if (!isEventName(event)) return null;
  const where: Record<string, Value> = {};
  if (colon !== -1) {
    for (const part of raw.slice(colon + 1).split(",")) {
      const eq = part.indexOf("=");
      if (eq === -1) continue;
      const property = part.slice(0, eq);
      const spec = specFor(event, property);
      const text = decode(part.slice(eq + 1));
      const value = spec && text !== null ? coerceFilterValue(spec, text) : undefined;
      if (value !== undefined) where[property] = value;
    }
  }
  return { event, where };
}

/** A step from form fields (strings): filters with a blank or invalid value are left out. */
export function stepFromFields(event: EventName, filters: { property: string; value: string }[]): ExploreStep {
  const where: Record<string, Value> = {};
  for (const { property, value } of filters) {
    const spec = specFor(event, property);
    const coerced = spec ? coerceFilterValue(spec, value) : undefined;
    if (coerced !== undefined) where[property] = coerced;
  }
  return { event, where };
}

export function formatStep(step: ExploreStep): string {
  const filters = Object.entries(step.where).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return filters.length ? `${step.event}:${filters.join(",")}` : step.event;
}

const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export function parseSteps(raw: string | string[] | undefined): ExploreStep[] {
  return asList(raw)
    .map(parseStep)
    .filter((s): s is ExploreStep => s !== null)
    .slice(0, MAX_STEPS);
}

export function parseBreakdown(raw: string | string[] | undefined): Breakdown | null {
  const value = asList(raw)[0];
  const dot = value?.indexOf(".") ?? -1;
  if (!value || dot === -1) return null;
  const event = value.slice(0, dot);
  const property = value.slice(dot + 1);
  return isEventName(event) && specFor(event, property) ? { event, property } : null;
}

export function exploreHref(state: { days: number; steps: ExploreStep[]; breakdown: Breakdown | null }): string {
  const params = new URLSearchParams({ days: String(state.days) });
  for (const step of state.steps) params.append("step", formatStep(step));
  if (state.breakdown) params.set("breakdown", `${state.breakdown.event}.${state.breakdown.property}`);
  return `/admin/analytics/explore?${params}`;
}
