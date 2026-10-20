import { audienceQuery, type Audience } from "@/lib/analytics/audience";
import { EVENTS, isEventName, type EventName } from "@/lib/analytics/events";

/**
 * The usage explorer's question as a URL, so a view can be shared and bookmarked:
 *
 *   /admin/analytics/explore?days=30&step=onair_popover_opened:live=true&step=onair_join_clicked:live=true&breakdown=element_clicked.text&bfilter=element=button
 *
 * A `step` is an event name, optionally followed by `:` and `prop=value` filters joined by `,`
 * (values percent-encoded, so they can hold either). A `breakdown` is `event.property`, with its
 * own filters in `bfilter` (the same `prop=value,...`), so it counts the events you mean rather
 * than whatever the funnel above happens to filter. Everything is checked against the tracking
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
  where: Record<string, Value>;
}

type PropSpec = { kind: "bool" | "int" | "enum" | "text"; values?: readonly string[] };

/** Whether the plan declares this property for this event. */
export function isDeclaredProperty(event: EventName, property: string): boolean {
  return specFor(event, property) !== null;
}

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

/** Filters written `prop=value,prop=value` (values percent-encoded) for an event; invalid ones are dropped. */
export function parseFilters(event: EventName, raw: string): Record<string, Value> {
  const where: Record<string, Value> = {};
  for (const part of raw.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const property = part.slice(0, eq);
    const spec = specFor(event, property);
    const text = decode(part.slice(eq + 1));
    const value = spec && text !== null ? coerceFilterValue(spec, text) : undefined;
    if (value !== undefined) where[property] = value;
  }
  return where;
}

export function formatFilters(where: Record<string, Value>): string {
  return Object.entries(where)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join(",");
}

export function parseStep(raw: string): ExploreStep | null {
  const colon = raw.indexOf(":");
  const event = colon === -1 ? raw : raw.slice(0, colon);
  if (!isEventName(event)) return null;
  return { event, where: colon === -1 ? {} : parseFilters(event, raw.slice(colon + 1)) };
}

/** Filters from form fields (strings): ones with a blank or invalid value are left out. */
export function filtersFromFields(event: EventName, filters: { property: string; value: string }[]): Record<string, Value> {
  const where: Record<string, Value> = {};
  for (const { property, value } of filters) {
    const spec = specFor(event, property);
    const coerced = spec ? coerceFilterValue(spec, value) : undefined;
    if (coerced !== undefined) where[property] = coerced;
  }
  return where;
}

/** A step from form fields (strings). */
export function stepFromFields(event: EventName, filters: { property: string; value: string }[]): ExploreStep {
  return { event, where: filtersFromFields(event, filters) };
}

export function formatStep(step: ExploreStep): string {
  const filters = formatFilters(step.where);
  return filters ? `${step.event}:${filters}` : step.event;
}

const asList = (value: string | string[] | undefined): string[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

export function parseSteps(raw: string | string[] | undefined): ExploreStep[] {
  return asList(raw)
    .map(parseStep)
    .filter((s): s is ExploreStep => s !== null)
    .slice(0, MAX_STEPS);
}

export function parseBreakdown(raw: string | string[] | undefined, filters?: string | string[]): Breakdown | null {
  const value = asList(raw)[0];
  const dot = value?.indexOf(".") ?? -1;
  if (!value || dot === -1) return null;
  const event = value.slice(0, dot);
  const property = value.slice(dot + 1);
  if (!isEventName(event) || !specFor(event, property)) return null;
  return { event, property, where: parseFilters(event, asList(filters)[0] ?? "") };
}

export function exploreHref(state: { days: number; steps: ExploreStep[]; breakdown: Breakdown | null; audience?: Audience }): string {
  const params = new URLSearchParams({ days: String(state.days) });
  if (state.audience) for (const [key, value] of Object.entries(audienceQuery(state.audience))) params.set(key, value);
  for (const step of state.steps) params.append("step", formatStep(step));
  if (state.breakdown) {
    params.set("breakdown", `${state.breakdown.event}.${state.breakdown.property}`);
    const filters = formatFilters(state.breakdown.where);
    if (filters) params.set("bfilter", filters);
  }
  return `/admin/analytics/explore?${params}`;
}
