import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-auth";
import { FUNNELS, WINDOW_DAYS, parseWindowDays } from "@/lib/analytics/funnels";
import { FunnelBars } from "@/components/admin/FunnelBars";

export const metadata: Metadata = {
  title: "Feature Usage",
};

export const maxDuration = 60;

interface EventSummaryRow {
  event: string;
  events: number;
  members: number;
  sessions: number;
  last_seen: string;
}

interface TopClickRow {
  label: string;
  element: string | null;
  events: number;
  members: number;
  sessions: number;
  routes: number;
}

const DAY_MS = 24 * 60 * 60_000;

type Params = { days?: string; route?: string; admin?: string };

export default async function FeatureUsagePage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireAdminPage();
  const params = await searchParams;
  const days = parseWindowDays(params.days);
  // Staff clicking around the admin area would drown out what members do, so it starts hidden.
  const showAdmin = params.admin === "show";
  const routePrefix = params.route?.trim().slice(0, 120) || null;
  const since = new Date(Date.now() - days * DAY_MS).toISOString();

  const supabase = await createClient();
  const [summary, topClicks, ...funnels] = await Promise.all([
    supabase.rpc("analytics_event_summary", { since }),
    supabase.rpc("analytics_top_clicks", { since, route_prefix: routePrefix, hide_admin: !showAdmin }),
    ...FUNNELS.map((f) => supabase.rpc("analytics_funnel", { steps: f.steps.map((s) => s.event), since, filters: f.steps.map((s) => s.where ?? {}) })),
  ]);
  const error = summary.error ?? topClicks.error ?? funnels.find((f) => f.error)?.error;

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Feature Usage</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          What members do in the Hub, from the usage log (the events are listed in lib/analytics/events.ts).
          Views while an admin is viewing as a member are left out.
        </p>
        <Link
          href="/admin/analytics/explore"
          className="mt-3 inline-block px-3 py-1.5 text-sm rounded-lg bg-plum-600 hover:bg-plum-700 text-white font-medium"
        >
          Explore: build a funnel or breakdown
        </Link>
        <div className="mt-3 flex gap-2 text-sm">
          {WINDOW_DAYS.map((d) => (
            <Link
              key={d}
              href={`/admin/analytics?${new URLSearchParams({ days: String(d), ...(routePrefix ? { route: routePrefix } : {}), ...(showAdmin ? { admin: "show" } : {}) })}`}
              className={`px-3 py-1 rounded-lg border ${
                d === days
                  ? "border-plum-600 bg-plum-50 dark:bg-plum-900/20 text-plum-700 dark:text-plum-300"
                  : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              }`}
            >
              Last {d} days
            </Link>
          ))}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">Could not load usage: {error.message}</p>}

      {FUNNELS.map((funnel, i) => {
        const rows = (funnels[i].data ?? []) as { sessions: number }[];
        return (
          <section key={funnel.title}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{funnel.title}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{funnel.description}</p>
            <FunnelBars steps={funnel.steps.map((step, s) => ({ label: step.label, count: Number(rows[s]?.sessions ?? 0) }))} />
          </section>
        );
      })}

      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Most-clicked things</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Every button, link and control members click, named by its label (or <code>data-track</code> name, or where a link goes). Links to a
          person or record show only where they go, never the name.
        </p>
        <form method="get" className="mt-3 flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="days" value={days} />
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            Only pages under
            <input
              name="route"
              defaultValue={routePrefix ?? ""}
              placeholder="/courses"
              className="rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1 text-slate-900 dark:text-slate-100"
            />
          </label>
          <label className="flex items-center gap-2 text-slate-600 dark:text-slate-400">
            <input type="checkbox" name="admin" value="show" defaultChecked={showAdmin} />
            Include admin pages
          </label>
          <button type="submit" className="px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800">
            Apply
          </button>
        </form>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Clicked</th>
                <th className="px-3 py-2">Kind</th>
                <th className="px-3 py-2 text-right">Times</th>
                <th className="px-3 py-2 text-right">Members</th>
                <th className="px-3 py-2 text-right">Visits</th>
                <th className="px-3 py-2 text-right">Pages</th>
              </tr>
            </thead>
            <tbody>
              {((topClicks.data ?? []) as TopClickRow[]).map((row) => (
                <tr key={`${row.label}|${row.element}`} className="border-t border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                  <td className="px-3 py-2">
                    {row.label === "(unlabelled)" ? <span className="text-slate-500">(unlabelled)</span> : <span className="font-mono text-xs">{row.label}</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{row.element ?? ""}</td>
                  <td className="px-3 py-2 text-right">{row.events}</td>
                  <td className="px-3 py-2 text-right">{row.members}</td>
                  <td className="px-3 py-2 text-right">{row.sessions}</td>
                  <td className="px-3 py-2 text-right">{row.routes}</td>
                </tr>
              ))}
              {(topClicks.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                    No clicks in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">All events</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800 text-left text-slate-600 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Event</th>
                <th className="px-3 py-2 text-right">Times</th>
                <th className="px-3 py-2 text-right">Members</th>
                <th className="px-3 py-2 text-right">Visits</th>
                <th className="px-3 py-2">Last seen</th>
              </tr>
            </thead>
            <tbody>
              {((summary.data ?? []) as EventSummaryRow[]).map((row) => (
                <tr key={row.event} className="border-t border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
                  <td className="px-3 py-2 font-mono text-xs">{row.event}</td>
                  <td className="px-3 py-2 text-right">{row.events}</td>
                  <td className="px-3 py-2 text-right">{row.members}</td>
                  <td className="px-3 py-2 text-right">{row.sessions}</td>
                  <td className="px-3 py-2">{new Date(row.last_seen).toLocaleString("en-US")}</td>
                </tr>
              ))}
              {(summary.data ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                    No events yet in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
