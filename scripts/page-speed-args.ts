// The pure parts of scripts/page-speed.ts (argument parsing, reading `vercel metrics` output, the table), kept apart so
// they are tested without the CLI.

export const GRANULARITIES = ["5m", "15m", "1h", "1d"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** The routes members use most, so a run answers "did the member pages get faster" without a list. */
export const DEFAULT_ROUTES = ["/dashboard", "/my-prickles", "/settings", "/projects", "/courses", "/chat/[id]", "/members"];

export interface PageSpeedArgs {
  from: string;
  to: string;
  granularity: Granularity;
  routes: string[];
  label: string | null;
  record: boolean;
}

/** `vercel metrics` snaps a window to whole buckets of its granularity, so a short window needs a fine one. */
export function parsePageSpeedArgs(argv: string[], now: Date): PageSpeedArgs {
  const values = new Map<string, string>();
  let record = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--record") record = true;
    else if (arg.startsWith("--")) {
      const value = argv[++i];
      if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      values.set(arg.slice(2), value);
    } else throw new Error(`Unexpected argument ${arg}`);
  }
  for (const key of values.keys()) {
    if (!["from", "to", "granularity", "routes", "label"].includes(key)) throw new Error(`Unknown option --${key}`);
  }
  const to = values.get("to") ?? now.toISOString();
  const from = values.get("from") ?? new Date(Date.parse(to) - 24 * 3_600_000).toISOString();
  for (const [name, value] of [["--from", from], ["--to", to]]) {
    if (Number.isNaN(Date.parse(value))) throw new Error(`${name} must be a date, such as 2026-11-03T03:50:00Z`);
  }
  if (Date.parse(from) >= Date.parse(to)) throw new Error("--from must be before --to");
  const granularity = (values.get("granularity") ?? "1h") as Granularity;
  if (!GRANULARITIES.includes(granularity)) throw new Error(`--granularity must be one of ${GRANULARITIES.join(", ")}`);
  const routes = values.get("routes")?.split(",").map((r) => r.trim()).filter(Boolean) ?? DEFAULT_ROUTES;
  return { from, to, granularity, routes, label: values.get("label") ?? null, record };
}

/** One value per route from the `summary` of `vercel metrics --json`; the CLI may print a hint line before the JSON. */
export function summaryByRoute(output: string): Map<string, number> {
  const start = output.indexOf("{");
  if (start < 0) throw new Error("No JSON in the vercel metrics output");
  const json = JSON.parse(output.slice(start)) as { summary?: Array<Record<string, unknown>> };
  const byRoute = new Map<string, number>();
  for (const row of json.summary ?? []) {
    const value = Object.values(row).find((v): v is number => typeof v === "number");
    if (typeof row.route === "string" && value !== undefined) byRoute.set(row.route, value);
  }
  return byRoute;
}

export interface RouteRow {
  route: string;
  /** Requests the function served in the window. */
  requests: number;
  serverP50: number | undefined;
  serverP75: number | undefined;
  /** Real-user page loads (Speed Insights) in the window, and their p75 timings. */
  visits: number | undefined;
  fcpP75: number | undefined;
  lcpP75: number | undefined;
  ttfbP75: number | undefined;
}

const ms = (value: number | undefined) => (value === undefined ? "-" : `${Math.round(value)}`);

/** A GitHub-flavoured table, one row per route that had any traffic. Times are milliseconds. */
export function formatTable(rows: RouteRow[]): string {
  const lines = [
    "| Route | Requests | Server p50 | Server p75 | Visits | FCP p75 | LCP p75 | TTFB p75 |",
    "|---|---:|---:|---:|---:|---:|---:|---:|",
  ];
  for (const r of rows) {
    lines.push(`| \`${r.route}\` | ${r.requests} | ${ms(r.serverP50)} | ${ms(r.serverP75)} | ${r.visits ?? "-"} | ${ms(r.fcpP75)} | ${ms(r.lcpP75)} | ${ms(r.ttfbP75)} |`);
  }
  return lines.join("\n");
}

/** The block `--record` appends to the baseline doc: what was measured, which window, and the table. */
export function formatRecord(args: PageSpeedArgs, table: string, commit: string | null): string {
  const title = args.label ?? `${args.from.slice(0, 10)}`;
  return [
    `### ${title}`,
    "",
    `Window ${args.from} to ${args.to} (UTC, ${args.granularity} buckets)${commit ? `; recorded with production at ${commit}` : ""}. Milliseconds.`,
    "",
    table,
    "",
  ].join("\n");
}
