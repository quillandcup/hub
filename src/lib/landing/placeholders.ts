import { clock } from "@/lib/clock";
import { ORG_TIMEZONE } from "@/lib/config";

/**
 * Placeholders: small tokens in a text that fill themselves in when the text is shown (`{year}`, `{year:2019}`). The registry below
 * is the one list of them: the text field offers what it lists, the pages resolve through `resolvePlaceholders`, and a new one is
 * one entry here (docs/product/LANDING_PAGES.md, "Placeholders"). The stored text is always the plain token string, so import,
 * export and versions carry it as it is; only the field and the renderer ever give it a meaning.
 */

/** Where a field lives, which decides what it offers. A new kind of field names its own surface here. */
export type PlaceholderSurface = "footer";

/** What a placeholder may need to resolve. Resolving is pure: everything it reads is in here (the app clock is read once, by default). */
export interface PlaceholderContext {
  nowMs: number;
}

/** The one typed parameter an entry may take (`{year:2019}`): how it is asked for, and how a typed value is checked. */
export interface PlaceholderParamSpec {
  label: string;
  hint: string;
  /** A value that is valid, for an example and for the field's own tests. */
  sample: string;
  /** The value in its stored form, or null when it is not valid (the token is then left as written). */
  parse: (raw: string) => string | null;
}

export interface PlaceholderDef {
  /** The word in the braces, lowercase letters, digits and hyphens. */
  name: string;
  /** A plain word for staff, shown on the pill and in the list. */
  label: string;
  /** One line: what it shows and when it changes. */
  description: string;
  surfaces: readonly PlaceholderSurface[];
  param?: PlaceholderParamSpec;
  /** The text on its pill in the editor ("Year", "Year from 2019"). */
  pillLabel: (param?: string) => string;
  /** What it shows with no parameter, for the list. */
  example: (ctx: PlaceholderContext) => string;
  /** What it becomes. `param` is already checked by `param.parse`. */
  resolve: (param: string | undefined, ctx: PlaceholderContext) => string;
}

/** The current year in the org's zone (not the server's, which is UTC on Vercel), from the app clock so tests can move it. */
export function currentOrgYear(nowMs: number = clock.now()): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, year: "numeric" }).format(new Date(nowMs)));
}

const YEAR: PlaceholderDef = {
  name: "year",
  label: "Year",
  description: "The current year, which turns over each New Year by itself. Click it to add a start year and show a range such as 2019–2026.",
  surfaces: ["footer"],
  param: {
    label: "Start year",
    hint: "Four digits, such as 2019. Leave it empty to show only the current year.",
    sample: "2019",
    parse: (raw) => (/^\d{4}$/.test(raw) ? raw : null),
  },
  pillLabel: (param) => (param ? `Year from ${param}` : "Year"),
  example: (ctx) => String(currentOrgYear(ctx.nowMs)),
  resolve: (param, ctx) => {
    const year = currentOrgYear(ctx.nowMs);
    const start = param ? Number(param) : year;
    return start < year ? `${start}–${year}` : String(year);
  },
};

/** Every placeholder there is. Add one here, with a resolver test in tests/lib/landing-placeholders.test.ts (it fails on an entry without them). */
export const PLACEHOLDERS = [YEAR] as const satisfies readonly PlaceholderDef[];

export type PlaceholderName = (typeof PLACEHOLDERS)[number]["name"];

const BY_NAME: ReadonlyMap<string, PlaceholderDef> = new Map(PLACEHOLDERS.map((p) => [p.name, p]));

export function placeholderDef(name: string): PlaceholderDef | undefined {
  return BY_NAME.get(name);
}

/** The names a field on this surface offers. A field passes this to its `placeholders` prop, so a new entry reaches every such field. */
export function placeholdersFor(surface: PlaceholderSurface): PlaceholderName[] {
  return PLACEHOLDERS.filter((p) => (p.surfaces as readonly PlaceholderSurface[]).includes(surface)).map((p) => p.name);
}

/** The footer text fields (the site's, and a landing page's own) offer these. */
export const FOOTER_TEXT_PLACEHOLDERS: readonly PlaceholderName[] = placeholdersFor("footer");

export function placeholderToken(name: string, param?: string | null): string {
  return param ? `{${name}:${param}}` : `{${name}}`;
}

export type PlaceholderSegment = { kind: "text"; text: string } | { kind: "placeholder"; name: string; param?: string };

const TOKEN = /\{([a-z][a-z0-9-]*)(?::([^{}]*))?\}/g;

/**
 * The text as plain pieces and known placeholders. A `{...}` that is not a registry entry, or whose parameter is not valid (or that
 * takes none), stays plain text exactly as written. `placeholderToken` puts a piece back, so joining the segments gives the text.
 */
export function splitPlaceholders(text: string): PlaceholderSegment[] {
  const out: PlaceholderSegment[] = [];
  let last = 0;
  const pushText = (to: number, from = last) => {
    if (to > from) out.push({ kind: "text", text: text.slice(from, to) });
  };
  for (const m of text.matchAll(TOKEN)) {
    const def = BY_NAME.get(m[1]);
    const raw = m[2];
    let param: string | undefined;
    if (!def) continue;
    if (raw !== undefined) {
      const parsed = def.param?.parse(raw) ?? null;
      if (parsed === null) continue;
      param = parsed;
    }
    pushText(m.index);
    out.push({ kind: "placeholder", name: def.name, ...(param === undefined ? {} : { param }) });
    last = m.index + m[0].length;
  }
  pushText(text.length);
  return out;
}

/** The segments written back as the stored text. */
export function joinPlaceholders(segments: readonly PlaceholderSegment[]): string {
  return segments.map((s) => (s.kind === "text" ? s.text : placeholderToken(s.name, s.param))).join("");
}

/** The text with every known placeholder filled in, as visitors see it. Unknown or invalid tokens stay as written. `ctx.nowMs` defaults to the app clock. */
export function resolvePlaceholders(text: string, ctx: Partial<PlaceholderContext> = {}): string {
  if (!text.includes("{")) return text;
  const full: PlaceholderContext = { nowMs: ctx.nowMs ?? clock.now() };
  return splitPlaceholders(text)
    .map((s) => (s.kind === "text" ? s.text : (BY_NAME.get(s.name) as PlaceholderDef).resolve(s.param, full)))
    .join("");
}
