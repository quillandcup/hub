"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDescription, EventName, PropertyDescription } from "@/lib/analytics/events";
import type { Audience } from "@/lib/analytics/audience";
import { MAX_STEPS, exploreHref, filtersFromFields, stepFromFields, type Breakdown, type ExploreStep } from "@/lib/analytics/explore";
import { WINDOW_DAYS } from "@/lib/analytics/funnels";
import { suggestFilterValues } from "./actions";

interface FormFilter {
  property: string;
  value: string;
}

interface FormStep {
  event: EventName;
  filters: FormFilter[];
}

interface FormBreakdown extends FormStep {
  property: string;
}

const field =
  "rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100";
const button =
  "px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";

const toFilters = (where: Record<string, boolean | number | string>): FormFilter[] =>
  Object.entries(where).map(([property, value]) => ({ property, value: String(value) }));

/** A free-form filter value (text or number) with the values that really occur offered as suggestions. */
function ValueInput({
  label,
  event,
  prop,
  value,
  onChange,
}: {
  label: string;
  event: EventName;
  prop: PropertyDescription;
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const [suggestions, setSuggestions] = useState<string[]>([]);

  useEffect(() => {
    let current = true;
    suggestFilterValues(event, prop.name).then((values) => current && setSuggestions(values));
    return () => {
      current = false;
    };
  }, [event, prop.name]);

  return (
    <>
      <input
        aria-label={label}
        className={field}
        type={prop.kind === "int" ? "number" : "text"}
        min={0}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <datalist id={listId}>
        {suggestions.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
    </>
  );
}

/** The `where <property> is <value>` rows under a step or the breakdown. */
function FilterRows({
  label,
  event,
  props,
  filters,
  onChange,
}: {
  label: string;
  event: EventName;
  props: PropertyDescription[];
  filters: FormFilter[];
  onChange: (filters: FormFilter[]) => void;
}) {
  return (
    <>
      {filters.map((filter, f) => {
        const prop = props.find((p) => p.name === filter.property) ?? props[0];
        const setFilter = (next: FormFilter) => onChange(filters.map((x, k) => (k === f ? next : x)));
        const valueLabel = `${label} filter ${f + 1} value`;
        return (
          <div key={f} className="flex flex-wrap items-center gap-2 pl-16">
            <span className="text-sm text-slate-600 dark:text-slate-400">where</span>
            <select
              aria-label={`${label} filter ${f + 1} property`}
              className={field}
              value={prop?.name}
              onChange={(e) => setFilter({ property: e.target.value, value: "" })}
            >
              {props.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="text-sm text-slate-600 dark:text-slate-400">is</span>
            {prop?.kind === "bool" || prop?.kind === "enum" ? (
              <select aria-label={valueLabel} className={field} value={filter.value} onChange={(e) => setFilter({ ...filter, value: e.target.value })}>
                <option value="">choose…</option>
                {(prop.kind === "bool" ? ["true", "false"] : (prop.values ?? [])).map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <ValueInput label={valueLabel} event={event} prop={prop} value={filter.value} onChange={(value) => setFilter({ ...filter, value })} />
            )}
            <button type="button" className={button} onClick={() => onChange(filters.filter((_, k) => k !== f))}>
              Remove
            </button>
          </div>
        );
      })}
    </>
  );
}

/**
 * Builds the explorer's question from the tracking plan: pick the events of a funnel and, for
 * each, filters on its declared properties; optionally count one event by one property, with
 * its own filters. Free-form filter values offer the values that really occur. Running it
 * navigates to the URL form of the question (lib/analytics/explore.ts), which the page answers.
 */
export function ExploreForm({
  events,
  initialSteps,
  initialBreakdown,
  initialDays,
  audience,
}: {
  events: EventDescription[];
  initialSteps: ExploreStep[];
  initialBreakdown: Breakdown | null;
  initialDays: number;
  /** The usage page's who-to-count filters, kept when the question is run again. */
  audience: Audience;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<FormStep[]>(initialSteps.map((s) => ({ event: s.event, filters: toFilters(s.where) })));
  const [breakdown, setBreakdown] = useState<FormBreakdown | null>(
    initialBreakdown && { event: initialBreakdown.event, property: initialBreakdown.property, filters: toFilters(initialBreakdown.where) }
  );
  const [days, setDays] = useState(initialDays);

  const describe = (name: EventName) => events.find((e) => e.name === name)!;
  const update = (i: number, step: FormStep) => setSteps((all) => all.map((s, j) => (j === i ? step : s)));
  const firstProperty = (name: EventName) => describe(name).properties[0]?.name ?? "";

  function run(e: React.FormEvent) {
    e.preventDefault();
    router.push(
      exploreHref({
        audience,
        days,
        steps: steps.map((s) => stepFromFields(s.event, s.filters)),
        breakdown: breakdown && {
          event: breakdown.event,
          property: breakdown.property,
          where: filtersFromFields(breakdown.event, breakdown.filters),
        },
      })
    );
  }

  return (
    <form onSubmit={run} className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Funnel steps, in order</legend>
        {steps.map((step, i) => {
          const props = describe(step.event).properties;
          return (
            <div key={i} className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-400 w-14">Step {i + 1}</span>
                <select
                  aria-label={`Step ${i + 1} event`}
                  className={field}
                  value={step.event}
                  onChange={(e) => update(i, { event: e.target.value as EventName, filters: [] })}
                >
                  {events.map((ev) => (
                    <option key={ev.name} value={ev.name}>
                      {ev.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={button} onClick={() => update(i, { ...step, filters: [...step.filters, { property: props[0]?.name ?? "", value: "" }] })} disabled={props.length === 0}>
                  Add filter
                </button>
                <button type="button" className={button} onClick={() => setSteps((all) => all.filter((_, j) => j !== i))}>
                  Remove step
                </button>
              </div>
              <FilterRows label={`Step ${i + 1}`} event={step.event} props={props} filters={step.filters} onChange={(filters) => update(i, { ...step, filters })} />
            </div>
          );
        })}
        <button type="button" className={button} disabled={steps.length >= MAX_STEPS} onClick={() => setSteps((all) => [...all, { event: events[0].name, filters: [] }])}>
          Add step
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Break down by (optional)</legend>
        <p className="text-xs text-slate-600 dark:text-slate-400">Counts one event by the values of a property. It has its own filters; the funnel&apos;s don&apos;t apply to it.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Breakdown event"
            className={field}
            value={breakdown?.event ?? ""}
            onChange={(e) => {
              const event = e.target.value as EventName | "";
              setBreakdown(event ? { event, property: firstProperty(event), filters: [] } : null);
            }}
          >
            <option value="">none</option>
            {events
              .filter((ev) => ev.properties.length > 0)
              .map((ev) => (
                <option key={ev.name} value={ev.name}>
                  {ev.name}
                </option>
              ))}
          </select>
          {breakdown && (
            <>
              <span className="text-sm text-slate-600 dark:text-slate-400">by</span>
              <select aria-label="Breakdown property" className={field} value={breakdown.property} onChange={(e) => setBreakdown({ ...breakdown, property: e.target.value })}>
                {describe(breakdown.event).properties.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button type="button" className={button} onClick={() => setBreakdown({ ...breakdown, filters: [...breakdown.filters, { property: firstProperty(breakdown.event), value: "" }] })}>
                Add filter
              </button>
            </>
          )}
        </div>
        {breakdown && (
          <FilterRows
            label="Breakdown"
            event={breakdown.event}
            props={describe(breakdown.event).properties}
            filters={breakdown.filters}
            onChange={(filters) => setBreakdown({ ...breakdown, filters })}
          />
        )}
      </fieldset>

      <div className="flex items-center gap-3">
        <label className="text-sm text-slate-600 dark:text-slate-400" htmlFor="explore-days">
          Window
        </label>
        <select id="explore-days" className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {WINDOW_DAYS.map((d) => (
            <option key={d} value={d}>
              Last {d} days
            </option>
          ))}
        </select>
        <button type="submit" className="px-4 py-1.5 text-sm rounded-lg bg-plum-600 hover:bg-plum-700 text-white font-medium">
          Run
        </button>
      </div>
    </form>
  );
}
