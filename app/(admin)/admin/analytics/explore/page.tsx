import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";
import { AudienceFilter } from "@/components/admin/AudienceFilter";
import { audienceRpcArgs, parseAudience } from "@/lib/analytics/audience";
import { describeEvents } from "@/lib/analytics/events";
import { parseBreakdown, parseSteps } from "@/lib/analytics/explore";
import { parseWindowDays } from "@/lib/analytics/funnels";
import { FunnelBars } from "@/components/admin/FunnelBars";
import { ExploreForm } from "./ExploreForm";

export const metadata: Metadata = {
  title: "Explore Usage",
};

export const maxDuration = 60;

const DAY_MS = 24 * 60 * 60_000;

type Params = { days?: string; step?: string | string[]; breakdown?: string; bfilter?: string; staff?: string; sudo?: string };

interface BreakdownRow {
  value: string | null;
  events: number;
  members: number;
  sessions: number;
}

export default async function ExploreUsagePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();
  const params = await searchParams;
  const days = parseWindowDays(params.days);
  const steps = parseSteps(params.step);
  const breakdown = parseBreakdown(params.breakdown, params.bfilter);
  const audience = parseAudience(params);
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  const supabase = await createClient();
  const [funnel, grouped] = await Promise.all([
    steps.length > 0
      ? supabase.rpc("analytics_funnel", { steps: steps.map((s) => s.event), since, filters: steps.map((s) => s.where), ...audienceRpcArgs(audience) })
      : null,
    breakdown
      ? supabase.rpc("analytics_property_breakdown", { event_name: breakdown.event, property: breakdown.property, since, filter: breakdown.where, ...audienceRpcArgs(audience) })
      : null,
  ]);
  const error = funnel?.error ?? grouped?.error;
  const funnelRows = (funnel?.data ?? []) as { sessions: number }[];
  const groupedRows = (grouped?.data ?? []) as BreakdownRow[];

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Explore Usage</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Build a funnel from any events in the tracking plan, filter each step by its properties, or count one event by
          the values of a property. The address of this page holds the question, so it can be bookmarked or shared.{" "}
          <Link href="/admin/analytics" className="text-plum-600 dark:text-plum-400 hover:underline">
            Back to Feature Usage
          </Link>
        </p>
        <AudienceFilter path="/admin/analytics/explore" params={params} audience={audience} />
      </div>

      <ExploreForm
        events={describeEvents()}
        initialSteps={steps}
        initialBreakdown={breakdown}
        initialDays={days}
        audience={audience}
        // The form keeps its own state; re-key it so following a link to another question resets it.
        key={`${days}|${audience.ignoreStaff}|${audience.ignoreSudo}|${steps.map((s) => JSON.stringify(s)).join("|")}|${JSON.stringify(breakdown)}`}
      />

      {error && <p className="text-sm text-red-600">Could not load usage: {error.message}</p>}

      {funnel && !funnel.error && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Funnel</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Visits (a member&apos;s session) that reached each step, in order. Last {days} days.
          </p>
          <FunnelBars
            steps={steps.map((step, i) => ({
              label:
                step.event +
                (Object.keys(step.where).length
                  ? ` (${Object.entries(step.where)
                      .map(([k, v]) => `${k} = ${v}`)
                      .join(", ")})`
                  : ""),
              count: Number(funnelRows[i]?.sessions ?? 0),
            }))}
          />
        </section>
      )}

      {breakdown && grouped && !grouped.error && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            {breakdown.event} by {breakdown.property}
          </h2>
          {Object.keys(breakdown.where).length > 0 && (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Only where{" "}
              {Object.entries(breakdown.where)
                .map(([k, v]) => `${k} = ${v}`)
                .join(", ")}
              .
            </p>
          )}
          <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-600 dark:text-slate-400">
                <tr>
                  <th className="px-3 py-2">{breakdown.property}</th>
                  <th className="px-3 py-2 text-right">Times</th>
                  <th className="px-3 py-2 text-right">Members</th>
                  <th className="px-3 py-2 text-right">Visits</th>
                </tr>
              </thead>
              <tbody>
                {groupedRows.map((row) => (
                  <tr key={row.value ?? "(not set)"} className="border-t border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                    <td className="px-3 py-2 font-mono text-xs">{row.value ?? "(not set)"}</td>
                    <td className="px-3 py-2 text-right">{row.events}</td>
                    <td className="px-3 py-2 text-right">{row.members}</td>
                    <td className="px-3 py-2 text-right">{row.sessions}</td>
                  </tr>
                ))}
                {groupedRows.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                      No events in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
