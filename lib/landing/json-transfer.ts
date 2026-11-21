import { BLOCK_DEFAULTS, SLOT_ALLOW, SLOTS } from "@/components/landing/config";
import { ORG_TIMEZONE } from "@/lib/config";
import { normalizeLandingData, type LandingData } from "./data";
import { LANDING_SCHEMA_VERSION, landingDataVersion } from "./migrations";

/**
 * Export and import of a landing page's JSON (docs/product/LANDING_PAGES.md, "Export and import"). Pure: the editor builds the
 * export in the browser from what it already holds, and the import action runs the same parsing and pruning on the
 * server. A file is untrusted input: this module only reads and reshapes it; sanitizing, picture checks and the write
 * are the action's.
 */

export const LANDING_EXPORT_FORMAT = "hedgie-landing-page";
export const LANDING_EXPORT_VERSION = 1;
/** The most a page's JSON may weigh, for save, publish, export and import alike. */
export const MAX_LANDING_BYTES = 2_000_000;
export const TOO_BIG_MESSAGE = "This page is over the 2 MB limit, so it can't be exported or imported as a file.";

export type ExportKind = "draft" | "published";

export type LandingExport = {
  format: typeof LANDING_EXPORT_FORMAT;
  version: typeof LANDING_EXPORT_VERSION;
  slug: string;
  title: string;
  kind: ExportKind;
  exportedAt: string;
  data: { content: unknown[]; root: Record<string, unknown>; schemaVersion: number };
};

/** The day in the org's zone as YYYY-MM-DD, for a file name. */
function orgDay(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** `home-draft-2026-11-20.json`: the page's address, which version, the day. */
export function exportFilename(slug: string, kind: ExportKind, now: Date): string {
  const safe = slug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "page";
  return `${safe}-${kind}-${orgDay(now)}.json`;
}

/**
 * The file for a page document: a small wrapper that says what it is, around the document as `normalizeLandingData`
 * returns it (content, root, schema version). No ids of rows or people, no audit data. Pretty-printed.
 */
export function buildLandingExport(input: { slug: string; title: string; kind: ExportKind; data: unknown; now: Date }): { ok: true; json: string; filename: string } | { ok: false; error: string } {
  const { content, root, schemaVersion } = normalizeLandingData(input.data);
  const data = { content, root, schemaVersion: schemaVersion ?? LANDING_SCHEMA_VERSION };
  if (JSON.stringify(data).length > MAX_LANDING_BYTES) return { ok: false, error: TOO_BIG_MESSAGE };
  const file: LandingExport = { format: LANDING_EXPORT_FORMAT, version: LANDING_EXPORT_VERSION, slug: input.slug, title: input.title, kind: input.kind, exportedAt: input.now.toISOString(), data };
  const json = JSON.stringify(file, null, 2);
  // The indented text is what is downloaded, so its size is what the message is about.
  if (json.length > MAX_LANDING_BYTES) return { ok: false, error: TOO_BIG_MESSAGE };
  return { ok: true, json, filename: exportFilename(input.slug, input.kind, input.now) };
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export type ImportSource = { slug?: string; title?: string; kind?: ExportKind };

/**
 * What a file or pasted text holds: the wrapper's page document, or a bare `{ content, root }` document. Anything else
 * is refused with a plain message. Nothing is cleaned here.
 */
export function parseLandingImport(text: string): { ok: true; document: Record<string, unknown>; source?: ImportSource } | { ok: false; error: string } {
  if (text.length > MAX_LANDING_BYTES) return { ok: false, error: "That file is over the 2 MB limit, so it can't be a page from the builder." };
  const trimmed = text.replace(/^﻿/, "").trim();
  if (!trimmed) return { ok: false, error: "Choose a file or paste the page's JSON first." };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "That isn't JSON. Choose a file exported from the page builder, or paste its whole text." };
  }
  if (!isObject(value)) return { ok: false, error: "That JSON isn't a page: it should be an object with a list of blocks." };

  let document: unknown = value;
  let source: ImportSource | undefined;
  if ("format" in value) {
    if (value.format !== LANDING_EXPORT_FORMAT) return { ok: false, error: "That file isn't a page exported from the page builder." };
    if (value.version !== LANDING_EXPORT_VERSION) return { ok: false, error: "That file was made by a different version of the page builder, and can't be read here." };
    document = value.data;
    source = {
      slug: typeof value.slug === "string" ? value.slug.slice(0, 80) : undefined,
      title: typeof value.title === "string" ? value.title.slice(0, 200) : undefined,
      kind: value.kind === "draft" || value.kind === "published" ? value.kind : undefined,
    };
  }
  if (!isObject(document) || !Array.isArray(document.content)) return { ok: false, error: "That JSON has no list of blocks (\"content\"), so it isn't a page." };
  if (landingDataVersion(document) > LANDING_SCHEMA_VERSION) return { ok: false, error: "That page was made by a newer version of the page builder than this one, and can't be read here." };
  return { ok: true, document, source };
}

// ---- reducing a document to what the builder has ----------------------------------------------------------

type Props = Record<string, unknown>;

/** Props every block may carry besides its own: its id and its width on a Section's grid. */
const COMMON_PROPS = ["id", "span", "spanMobile"];

/**
 * Props a block's editor offers that have no entry in `BLOCK_DEFAULTS` (a picture starts empty, so it has no default).
 * `tests/lib/landing-json-transfer.test.ts` fails when the editor has a field that is neither here nor in the defaults.
 */
export const EXTRA_PROPS: Record<string, string[]> = {
  Section: ["backgroundImageAssetId"],
  Image: ["imageAssetId"],
  Split: ["imageAssetId"],
  Hero: ["imageAssetId"],
  FinisherCard: ["imageAssetId"],
};

/** The page frame's own props (`root.props`). */
export const ROOT_PROPS = ["showHeader", "logoAssetId", "logoAlt", "logoHref", "navLinks", "showFooter", "footerText", "footerLinks"];

const isBlockType = (type: string): type is keyof typeof BLOCK_DEFAULTS => Object.hasOwn(BLOCK_DEFAULTS, type);

function allowedProps(type: keyof typeof BLOCK_DEFAULTS): Set<string> {
  return new Set([...Object.keys(BLOCK_DEFAULTS[type]), ...(SLOTS[type] ?? []), ...(EXTRA_PROPS[type] ?? []), ...COMMON_PROPS]);
}

export type Pruned = {
  data: LandingData;
  /** Blocks the builder doesn't have, by type, with how many were left out (a block's inner blocks go with it and are not counted). */
  leftOut: { type: string; count: number }[];
  /** Props a block does not have, which were dropped (counted, not named). */
  droppedProps: number;
};

/** How many blocks a document has, nested ones included. */
export function countBlocks(content: unknown): number {
  if (!Array.isArray(content)) return 0;
  let n = 0;
  for (const raw of content) {
    if (!isObject(raw) || !isObject(raw.props)) continue;
    n += 1;
    for (const value of Object.values(raw.props)) if (Array.isArray(value)) n += countBlocks(value);
  }
  return n;
}

/** What to call a block type in a message: a plain name for the ones that look like a block, "something else" for the rest. */
const typeLabel = (raw: unknown): string => (isObject(raw) && typeof raw.type === "string" && raw.type.trim() ? raw.type.trim().slice(0, 40) : "not a block");

/**
 * Keeps only blocks the builder has and, in each, only the props it has; blocks inside Sections and Columns are checked
 * the same way. A block without a usable id gets one, and a repeated id is replaced, so the editor never sees two blocks
 * alike. Expects a document `normalizeLandingData` has already brought up to date.
 */
export function pruneToKnownBlocks(input: LandingData): Pruned {
  const left = new Map<string, number>();
  let droppedProps = 0;
  const seen = new Set<string>();
  const used = (list: unknown[]) => {
    for (const raw of list) if (isObject(raw) && isObject(raw.props)) {
      if (typeof raw.props.id === "string") seen.add(raw.props.id);
      for (const value of Object.values(raw.props)) if (Array.isArray(value)) used(value);
    }
  };
  used(input.content);
  const claimed = new Set<string>();
  let counter = 0;
  const freshId = (type: string) => {
    let id: string;
    do id = `${type}-import${(counter++).toString(36)}`;
    while (seen.has(id));
    seen.add(id);
    return id;
  };

  const cleanList = (list: unknown[], allow?: readonly string[]): { type: string; props: Props }[] => {
    const out: { type: string; props: Props }[] = [];
    for (const raw of list) {
      // A slot that takes one kind of block (a Steps block's steps) keeps only that kind.
      if (!isObject(raw) || typeof raw.type !== "string" || !isObject(raw.props) || !isBlockType(raw.type) || (allow && !allow.includes(raw.type))) {
        const label = isObject(raw) && typeof raw.type === "string" && isObject(raw.props) ? typeLabel(raw) : "not a block";
        left.set(label, (left.get(label) ?? 0) + 1);
        continue;
      }
      const type = raw.type;
      const allowed = allowedProps(type);
      const slots = new Set(SLOTS[type] ?? []);
      const props: Props = {};
      for (const [key, value] of Object.entries(raw.props)) {
        if (!allowed.has(key)) {
          droppedProps += 1;
          continue;
        }
        props[key] = slots.has(key) ? (Array.isArray(value) ? cleanList(value, SLOT_ALLOW[type]?.[key]) : []) : value;
      }
      for (const slot of slots) if (!(slot in props)) props[slot] = [];
      // A first-seen id stays; a missing, odd or repeated one is replaced.
      if (typeof props.id !== "string" || !props.id || claimed.has(props.id)) props.id = freshId(type);
      claimed.add(props.id as string);
      out.push({ type, props });
    }
    return out;
  };

  const content = cleanList(input.content);
  const rootProps = isObject(input.root.props) ? input.root.props : {};
  const root: Props = {};
  if (isObject(input.root.props)) {
    const kept: Props = {};
    for (const [key, value] of Object.entries(rootProps)) {
      if (ROOT_PROPS.includes(key)) kept[key] = value;
      else droppedProps += 1;
    }
    root.props = kept;
  }
  return {
    data: { content, root, schemaVersion: input.schemaVersion },
    leftOut: [...left].map(([type, count]) => ({ type, count })),
    droppedProps,
  };
}
