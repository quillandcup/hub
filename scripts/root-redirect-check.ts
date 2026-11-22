// The pure parts of scripts/check-root-redirects.ts: reading the arguments and the URL list, working out what each URL should
// answer from the config (never from repeated literals), comparing it with what came back, and printing the table.
import { APP_URL, KAJABI_SITE_URL, SITE_URL } from "../src/lib/config";

export type Expectation = "kajabi" | "hub" | "login" | "serve";

export interface CheckEntry {
  /** Path and query, as requested. */
  path: string;
  expect: Expectation;
}

export interface Expected {
  status: number;
  /** null: no Location header expected. */
  location: string | null;
}

export interface Actual {
  status: number;
  location: string | null;
}

export interface CheckHosts {
  appUrl: string;
  kajabiUrl: string;
}

export const DEFAULT_HOSTS: CheckHosts = { appUrl: APP_URL, kajabiUrl: KAJABI_SITE_URL };

const EXPECTATIONS: readonly Expectation[] = ["kajabi", "hub", "login", "serve"];

/** `[base] [--file <list>] [--host <name>]`: the base URL defaults to the public site (config/app.ts `siteUrl`). */
export function parseArgs(argv: string[], defaultFile: string): { base: string; file: string; host: string | null } {
  let base = SITE_URL;
  let file = defaultFile;
  let host: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--file") file = argv[++i];
    else if (argv[i] === "--host") host = argv[++i];
    else base = argv[i].replace(/\/+$/, "");
  }
  return { base, file, host };
}

/** One entry per non-comment line: `<path> <expectation>`. Throws on a line it can't read, naming the line number. */
export function parseUrlList(text: string): CheckEntry[] {
  const entries: CheckEntry[] = [];
  text.split("\n").forEach((raw, index) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s+/);
    const [path, expect] = parts;
    if (parts.length !== 2 || !path.startsWith("/") || !EXPECTATIONS.includes(expect as Expectation)) {
      throw new Error(`Line ${index + 1}: expected "<path starting with /> <${EXPECTATIONS.join("|")}>", got "${line}"`);
    }
    entries.push({ path, expect: expect as Expectation });
  });
  return entries;
}

/** The address of `path` on `base`, written the way a Location header is (the URL parser's form). */
function onHost(base: string, path: string): string {
  return new URL(`${new URL(base).origin}${path}`).href;
}

/** What the root host should answer for an entry, from the configured hosts. */
export function expectedFor(entry: CheckEntry, hosts: CheckHosts = DEFAULT_HOSTS): Expected {
  switch (entry.expect) {
    case "kajabi":
      return { status: 307, location: onHost(hosts.kajabiUrl, entry.path) };
    case "hub":
      return { status: 307, location: onHost(hosts.appUrl, entry.path) };
    case "login": {
      const query = entry.path.includes("?") ? `?${entry.path.split("?").slice(1).join("?")}` : "";
      return { status: 307, location: onHost(hosts.appUrl, `/login${query}`) };
    }
    case "serve":
      return { status: 200, location: null };
  }
}

export interface Row {
  path: string;
  expected: Expected;
  actual: Actual | { error: string };
}

/**
 * Two Locations are the same when scheme, host and path match exactly and the query holds the same parameters. Next hands the proxy
 * a re-written query ("%20" arrives as "+", "%2f" as "%2F"): the same parameters, so the comparison reads them rather than the text.
 */
export function sameLocation(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  try {
    const x = new URL(a);
    const y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname && JSON.stringify([...x.searchParams]) === JSON.stringify([...y.searchParams]);
  } catch {
    return a === b;
  }
}

export function rowOk(row: Row): boolean {
  return !("error" in row.actual) && row.expected.status === row.actual.status && sameLocation(row.expected.location, row.actual.location);
}

const show = (value: Expected | Actual | { error: string }): string =>
  "error" in value ? `ERROR ${value.error}` : `${value.status}${value.location ? ` -> ${value.location}` : ""}`;

/** A plain-text table: one line per URL, "ok" or "MISMATCH", the expected and (when different) the actual outcome. */
export function formatTable(rows: readonly Row[]): string {
  const lines = rows.map((row) => {
    const ok = rowOk(row);
    return [ok ? "ok      " : "MISMATCH", row.path, `expected ${show(row.expected)}`, ok ? "" : `actual ${show(row.actual)}`].filter(Boolean).join("  |  ");
  });
  const bad = rows.filter((row) => !rowOk(row)).length;
  lines.push("", bad === 0 ? `All ${rows.length} URLs behave as expected.` : `${bad} of ${rows.length} URLs do not behave as expected.`);
  return lines.join("\n");
}
