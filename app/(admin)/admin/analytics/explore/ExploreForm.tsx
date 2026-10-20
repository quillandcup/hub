"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EventDescription, EventName } from "@/lib/analytics/events";
import { MAX_STEPS, exploreHref, stepFromFields, type Breakdown, type ExploreStep } from "@/lib/analytics/explore";
import { WINDOW_DAYS } from "@/lib/analytics/funnels";

interface FormFilter {
  property: string;
  value: string;
}

interface FormStep {
  event: EventName;
  filters: FormFilter[];
}

const field =
  "rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-sm text-slate-900 dark:text-slate-100";
const button =
  "px-3 py-1 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800";

function toFormStep(step: ExploreStep): FormStep {
  return { event: step.event, filters: Object.entries(step.where).map(([property, value]) => ({ property, value: String(value) })) };
}

/**
 * Builds the explorer's question from the tracking plan: pick the events of a funnel and, for
 * each, filters on its declared properties; optionally group one event by one property. Running
 * it navigates to the URL form of the question (lib/analytics/explore.ts), which the page answers.
 */
export function ExploreForm({
  events,
  initialSteps,
  initialBreakdown,
  initialDays,
}: {
  events: EventDescription[];
  initialSteps: ExploreStep[];
  initialBreakdown: Breakdown | null;
  initialDays: number;
}) {
  const router = useRouter();
  const [steps, setSteps] = useState<FormStep[]>(initialSteps.map(toFormStep));
  const [breakdown, setBreakdown] = useState<{ event: EventName; property: string } | null>(initialBreakdown);
  const [days, setDays] = useState(initialDays);

  const describe = (name: EventName) => events.find((e) => e.name === name)!;
  const update = (i: number, step: FormStep) => setSteps((all) => all.map((s, j) => (j === i ? step : s)));

  function run(e: React.FormEvent) {
    e.preventDefault();
    const parsed = steps.map((s) => stepFromFields(s.event, s.filters));
    router.push(exploreHref({ days, steps: parsed, breakdown }));
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
                <span className="text-sm text-slate-500 w-14">Step {i + 1}</span>
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
              {step.filters.map((filter, f) => {
                const prop = props.find((p) => p.name === filter.property) ?? props[0];
                const setFilter = (next: FormFilter) => update(i, { ...step, filters: step.filters.map((x, k) => (k === f ? next : x)) });
                return (
                  <div key={f} className="flex flex-wrap items-center gap-2 pl-16">
                    <span className="text-sm text-slate-500">where</span>
                    <select
                      aria-label={`Step ${i + 1} filter ${f + 1} property`}
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
                    <span className="text-sm text-slate-500">is</span>
                    {prop?.kind === "bool" || prop?.kind === "enum" ? (
                      <select aria-label={`Step ${i + 1} filter ${f + 1} value`} className={field} value={filter.value} onChange={(e) => setFilter({ ...filter, value: e.target.value })}>
                        <option value="">choose…</option>
                        {(prop.kind === "bool" ? ["true", "false"] : (prop.values ?? [])).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        aria-label={`Step ${i + 1} filter ${f + 1} value`}
                        className={field}
                        type={prop?.kind === "int" ? "number" : "text"}
                        min={0}
                        value={filter.value}
                        onChange={(e) => setFilter({ ...filter, value: e.target.value })}
                      />
                    )}
                    <button type="button" className={button} onClick={() => update(i, { ...step, filters: step.filters.filter((_, k) => k !== f) })}>
                      Remove
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
        <button type="button" className={button} disabled={steps.length >= MAX_STEPS} onClick={() => setSteps((all) => [...all, { event: events[0].name, filters: [] }])}>
          Add step
        </button>
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Break down by (optional)</legend>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Breakdown event"
            className={field}
            value={breakdown?.event ?? ""}
            onChange={(e) => {
              const event = e.target.value as EventName | "";
              setBreakdown(event ? { event, property: describe(event).properties[0]?.name ?? "" } : null);
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
              <span className="text-sm text-slate-500">by</span>
              <select aria-label="Breakdown property" className={field} value={breakdown.property} onChange={(e) => setBreakdown({ ...breakdown, property: e.target.value })}>
                {describe(breakdown.event).properties.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}
        </div>
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
