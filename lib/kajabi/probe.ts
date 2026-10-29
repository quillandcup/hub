/**
 * What the `courses:content --probe` mode prints about a Kajabi admin page (docs/COURSES.md, "Importing Kajabi
 * per-lesson progress"): which JSON requests it made and the shape of each response, so the real capture can
 * be written from what the page actually loads instead of a guess. Names and types only, never values: the
 * pages show members' names and emails, and the output is meant to be pasted into a chat or a PR.
 */

const MAX_DEPTH = 6;
const MAX_FIELDS = 120;

/** A request path with ids and query strings squeezed out, so the same request on two pages reads the same. */
export function normalizeRequestPath(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    path = url.split("?")[0];
  }
  return path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/:uuid").replace(/\/\d{5,}(?=\/|$)/g, "/:id");
}

/** The query parameter names of a URL (never their values). */
export function queryNames(url: string): string[] {
  try {
    return [...new Set([...new URL(url).searchParams.keys()])].sort();
  } catch {
    return [];
  }
}

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? "string(date)" : /^https?:\/\//.test(value) ? "string(url)" : "string";
  return typeof value;
}

/**
 * The fields of a JSON value as sorted `path: type` lines. Arrays collapse to `[]` and show the union of their
 * items' fields, so a list of 500 students reads like one. Depth and count are capped.
 */
export function describeJson(value: unknown): string[] {
  const out = new Map<string, Set<string>>();
  const visit = (node: unknown, path: string, depth: number) => {
    if (out.size >= MAX_FIELDS && !out.has(path)) return;
    const types = out.get(path) ?? new Set<string>();
    types.add(typeOf(node));
    out.set(path, types);
    if (depth >= MAX_DEPTH || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node.slice(0, 200)) visit(item, `${path}[]`, depth + 1);
      return;
    }
    for (const [key, child] of Object.entries(node)) visit(child, path ? `${path}.${key}` : key, depth + 1);
  };
  visit(value, "", 0);
  return [...out.entries()]
    .filter(([path]) => path !== "")
    .map(([path, types]) => `${path}: ${[...types].sort().join("|")}`)
    .sort();
}

/** One request seen during a probe. */
export interface ProbedRequest {
  method: string;
  status: number;
  path: string;
  query: string[];
  fields: string[];
}

/** The report the probe prints: one block per distinct request, in the order first seen. */
export function formatProbe(requests: readonly ProbedRequest[]): string {
  const merged = new Map<string, ProbedRequest & { count: number }>();
  for (const r of requests) {
    const key = `${r.method} ${r.path}`;
    const existing = merged.get(key);
    if (existing) {
      existing.count++;
      existing.fields = [...new Set([...existing.fields, ...r.fields])].sort();
      existing.query = [...new Set([...existing.query, ...r.query])].sort();
    } else {
      merged.set(key, { ...r, count: 1 });
    }
  }
  if (merged.size === 0) return "No JSON requests were seen.";
  return [...merged.values()]
    .map((r) => {
      const head = `${r.method} ${r.status} ${r.path}${r.count > 1 ? ` (x${r.count})` : ""}${r.query.length ? ` ?${r.query.join("&")}` : ""}`;
      return [head, ...r.fields.map((f) => `    ${f}`)].join("\n");
    })
    .join("\n\n");
}
