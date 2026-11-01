import { formatMetricValue, GRANULARITIES, METRICS, RANGES, type RangePreset, type TimeSeries } from "@/lib/courses/watch-timeseries";
import TimeSeriesChart from "./TimeSeriesChart";
import SoftGetForm from "./SoftGetForm";

const field = "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-950";

/**
 * "Over time" for one video, like Kajabi's Analytics modal: pick a metric, a date range (a preset or
 * your own dates) and day, week or month, and Apply. A plain GET form, so a view is a link that can be
 * shared and nothing here needs a script. The total is for the whole range (unique counts and rates
 * don't add up from the points).
 */
export default function TimeSeriesSection({
  series,
  preset,
  action,
  staff,
  variant = "page",
}: {
  series: TimeSeries;
  /** The range preset the form shows as chosen. */
  preset: RangePreset;
  /** Where the form sends (this page). */
  action: string;
  /** Keeps staff viewing included across Apply. */
  staff: boolean;
  /** "modal" drops the card (the modal is the card) and applies without leaving the page. */
  variant?: "page" | "modal";
}) {
  const metric = METRICS.find((m) => m.value === series.metric) ?? METRICS[0];
  const granularity = GRANULARITIES.find((g) => g.value === series.granularity) ?? GRANULARITIES[0];

  const modal = variant === "modal";
  const Form = modal ? SoftGetForm : "form";
  return (
    <div className={modal ? "" : "mt-6 rounded-lg bg-white p-6 shadow dark:bg-slate-900"}>
      <h2 className="text-lg font-semibold">Over time</h2>
      <Form action={action} className="mt-3 flex flex-wrap items-end gap-3">
        {staff && <input type="hidden" name="staff" value="1" />}
        <label className="text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">Metric</span>
          <select name="metric" defaultValue={series.metric} className={field}>
            {METRICS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">Range</span>
          <select name="range" defaultValue={preset} className={field}>
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">From</span>
          <input type="date" name="from" defaultValue={series.range.from} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">To</span>
          <input type="date" name="to" defaultValue={series.range.to} className={field} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600 dark:text-slate-400">By</span>
          <select name="by" defaultValue={series.granularity} className={field}>
            {GRANULARITIES.map((g) => (
              <option key={g.value} value={g.value}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" data-track="admin-watch-stats-apply" className="rounded-lg bg-plum-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-plum-700">
          Apply
        </button>
      </Form>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">The From and To dates are used when the range is &ldquo;Custom range&rdquo;.</p>

      <div className={modal ? "mt-3" : "mt-5"}>
        <div className={modal ? "flex flex-wrap items-baseline gap-x-3" : ""}>
          <p className="text-sm text-slate-600 dark:text-slate-400">{metric.label}</p>
          <p data-testid="series-total" className={`${modal ? "text-xl" : "text-3xl"} font-semibold tabular-nums`}>
            {formatMetricValue(series.total, series.unit)}
          </p>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-300">{metric.definition}</p>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
          {series.range.from} to {series.range.to}, by {series.granularity}. Each visit counts on the day it began.
        </p>
      </div>

      <div className={modal ? "mx-auto mt-3 max-w-3xl" : "mt-4"}>
        <TimeSeriesChart points={series.points} unit={series.unit} metricLabel={metric.label} granularityLabel={granularity.value} />
      </div>
    </div>
  );
}
