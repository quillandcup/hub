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
  /** The response's content type when it was not JSON (an HTML fragment, a script): only its type and path are known. */
  contentType?: string;
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
  if (merged.size === 0) return "No requests of interest were seen.";
  return [...merged.values()]
    .map((r) => {
      const head = `${r.method} ${r.status} ${r.path}${r.contentType ? ` [${r.contentType}]` : ""}${r.count > 1 ? ` (x${r.count})` : ""}${r.query.length ? ` ?${r.query.join("&")}` : ""}`;
      return [head, ...r.fields.map((f) => `    ${f}`)].join("\n");
    })
    .join("\n\n");
}

/**
 * Runs IN THE PAGE (so it must stay self-contained: no imports, no outer names): the structure of the parts of the
 * page whose class, id or data attribute names match `pattern` (say "comment"), as lines of `tag.classes xN attrs:
 * names | urls: paths`, plus the page's "Show more" / "Reply" style controls with their labels. Attribute NAMES and
 * the paths of link-like attributes (ids squeezed, no query) only: never an element's text or an attribute's value,
 * since the page holds members' words and names. Capped at 80 lines.
 */
export function describeDomShape(pattern: string): string[] {
  const re = new RegExp(pattern, "i");
  // Any attribute that holds an address: href, src, action, and data-whatever-url, -path, -endpoint.
  const isUrlAttr = (name: string) => /(^|-)(url|href|src|action|path|endpoint)$/.test(name);
  const squeeze = (value: string): string => {
    let path: string;
    try {
      path = new URL(value, "https://page.invalid").pathname;
    } catch {
      path = value.split("?")[0];
    }
    return path.replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}(?=\/|$)/gi, "/:uuid").replace(/\/\d{5,}(?=\/|$)/g, "/:id");
  };
  const control = /^(show more|load more|more comments|reply|post comment|view replies|next)\b/i;
  const groups = new Map<string, { count: number; attrs: Set<string>; urls: Set<string> }>();
  for (const el of Array.from(document.querySelectorAll("*"))) {
    const names = el.getAttributeNames();
    const cls = el.getAttribute("class") ?? "";
    const label = (el.tagName === "BUTTON" || el.tagName === "A" ? (el.textContent ?? "").trim() : "").slice(0, 30);
    const isControl = label !== "" && control.test(label);
    const matches = re.test(cls) || re.test(el.id) || names.some((n) => n.startsWith("data-") && re.test(n));
    if (!matches && !isControl) continue;
    const tokens = cls.split(/\s+/).filter(Boolean).slice(0, 5).join(".");
    const key = `${el.tagName.toLowerCase()}${tokens ? `.${tokens}` : ""}${isControl ? ` "${label}"` : ""}`;
    const group = groups.get(key) ?? { count: 0, attrs: new Set<string>(), urls: new Set<string>() };
    group.count++;
    for (const n of names) if (n !== "class" && n !== "style") group.attrs.add(n);
    for (const n of names) {
      if (!isUrlAttr(n)) continue;
      const value = el.getAttribute(n);
      // Only http(s) and relative addresses: any other scheme (javascript:, vbscript:, data:, mailto:...) is not a request the page makes.
      if (value && !value.startsWith("#") && !/^(?!https?:)[a-z][a-z0-9+.-]*:/i.test(value.trim())) group.urls.add(squeeze(value));
    }
    groups.set(key, group);
  }
  return [...groups.entries()]
    .slice(0, 80)
    .map(([key, g]) => `${key} x${g.count} attrs: ${[...g.attrs].sort().join(", ") || "none"}${g.urls.size ? ` | urls: ${[...g.urls].sort().slice(0, 4).join(", ")}` : ""}`);
}

/**
 * A hint for when the recording shows the page sending the browser to a login screen: Kajabi's member pages open
 * only through a preview link from the admin, so the address typed in is not enough. Null when no login was seen.
 */
export function loginHint(requests: readonly ProbedRequest[]): string | null {
  const sawLogin = requests.some((r) => /(^|\/)(login|sign_in)$/.test(r.path));
  if (!sawLogin) return null;
  return "The page sent the browser to a login screen, so what was recorded is the login, not the page. A member page opens through a preview link from the Kajabi admin: start the probe from the admin page that has the link, click it in the window (a new tab is recorded too), and open the part you want to see.";
}
