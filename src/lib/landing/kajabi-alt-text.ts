import { parseFragment } from "parse5";
import { aiConfigured, completeWithClaude, type ClaudeTool, type Complete } from "@/lib/landing/ai";
import type { LandingData } from "@/lib/landing/data";
import { PICTURE_PREFIX, type PictureSource } from "@/lib/landing/kajabi-import";

/**
 * Descriptions (alt text) for the pictures an import brings in without one (docs/product/LANDING_PAGES.md, "Importing from
 * Kajabi", "Picture descriptions"). The admin reviews a suggestion for each picture in the import dialog and what they leave in the
 * fields is what is written; nothing is applied unseen.
 *
 * PRIVACY: the pictures show real members, so no picture and no picture's bytes ever go to a model. The suggestion is written from text
 * context only: the picture's role (logo, picture beside text, card picture), the headings near it in the page and the brand name
 * from the footer line. Headings only, never body text (a page can carry a member's quote), and never a file name (it can be a
 * person's name). All of that is the page's own marketing copy, written by staff. When the model is not set up or does not answer,
 * the suggestion comes from the nearest heading or the role, by rules in this file, and the dialog says so.
 */

export type PictureRole = "logo" | "picture" | "side picture" | "card picture";

/** A picture that needs a description, as the dialog shows it. */
export type PictureSlot = {
  /** The id of the block that holds the picture (stable between reading the export and importing it). */
  id: string;
  role: PictureRole;
  /** The headings around the picture, nearest first (at most three), which are what a suggestion is written from. */
  headings: string[];
  /** A card's picture has a description and no "decorative" switch. */
  canBeDecorative: boolean;
  /** What is suggested without the model. */
  fallback: { alt: string; decorative: boolean };
};

export type AltEntry = { alt: string; decorative: boolean };
export type AltSuggestion = { id: string; alt: string; decorative: boolean; by: "ai" | "fallback" };

type Block = { type?: unknown; props?: Record<string, unknown> };
const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : "");
const clean = (s: string) => s.replace(/ /g, " ").replace(/\s+/g, " ").trim();
const short = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

const MAX_SLOTS = 30;
export const ALT_MAX = 160;

function textOfHtml(html: string): string {
  const read = (nodes: { nodeName: string; value?: string; childNodes?: unknown[] }[]): string => nodes.map((n) => (n.nodeName === "#text" ? (n.value ?? "") : read((n.childNodes ?? []) as never))).join("");
  return clean(read(parseFragment(html).childNodes as never));
}

/** The first heading in a bit of HTML (a Split's words), or "". */
function htmlHeading(html: string): string {
  const m = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(html);
  return m ? short(textOfHtml(m[1])) : "";
}

/** The brand name: the footer's copyright line without its mark and year, or "". */
export function brandOf(data: LandingData): string {
  const text = str((data.root as { props?: Record<string, unknown> } | undefined)?.props?.footerText);
  return short(clean(text.replace(/^©\s*/, "").replace(/^\d{4}\s*/, "")), 80);
}

const GENERIC = /^(image|img|photo|picture|pic|screenshot|untitled|logo|banner|header|background|asset)[\s._-]*\d*$/i;

/** A file name worth using in a suggestion made here (never sent to a model): words, not a camera name or a hash. */
function wordsOfFile(name: string | undefined): string {
  const stem = clean((name ?? "").replace(/^.*\//, "").replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[_-]+/g, " "));
  if (stem.length < 4 || !/[a-z]{3}/i.test(stem) || GENERIC.test(stem) || /\d{3,}/.test(stem) || /^[0-9a-f ]{8,}$/i.test(stem)) return "";
  return stem;
}

/** Every picture without a description in the imported page, with what is around it. `files` maps a picture's placeholder to where it came from. */
export function pictureSlots(data: LandingData, input: { logoBlockId: string | null; pictures: PictureSource[] }): PictureSlot[] {
  const brand = brandOf(data);
  const files = new Map(input.pictures.map((p) => [p.placeholder, p.zipName ?? p.url]));
  const slots: PictureSlot[] = [];

  /** The text of a section's first heading, shallow: the headings that sit directly in its content. */
  const sectionHeading = (content: unknown): string => {
    const found = (Array.isArray(content) ? content : []).find((b) => isObject(b) && b.type === "Heading" && isObject(b.props) && clean(str(b.props.text)));
    return found && isObject(found.props) ? short(clean(str(found.props.text))) : "";
  };

  const walk = (blocks: unknown, enclosing: string) => {
    if (!Array.isArray(blocks)) return;
    const list = blocks.filter((b): b is Block & { props: Record<string, unknown> } => isObject(b) && isObject(b.props));
    const headingAt = (i: number) => (list[i].type === "Heading" ? short(clean(str(list[i].props.text))) : "");
    list.forEach((block, i) => {
      const p = block.props;
      const type = str(block.type);
      const placeholder = str(p.imageAssetId);
      const needs = placeholder.startsWith(PICTURE_PREFIX) && !clean(str(p.alt)) && !p.decorative;
      if (needs && (type === "Image" || type === "Split" || type === "GridCard") && slots.length < MAX_SLOTS) {
        // The nearest heading before the picture, else the next one after it.
        let near = "";
        for (let k = i - 1; k >= 0 && !near; k--) near = headingAt(k);
        for (let k = i + 1; k < list.length && !near; k++) near = headingAt(k);
        const own = type === "Split" ? htmlHeading(str(p.html)) : type === "GridCard" ? short(clean(str(p.title))) : "";
        const headings = [...new Set([own, near, enclosing].filter(Boolean))].slice(0, 3);
        const logo = p.id === input.logoBlockId;
        const role: PictureRole = logo ? "logo" : type === "Split" ? "side picture" : type === "GridCard" ? "card picture" : "picture";
        const words = wordsOfFile(files.get(placeholder));
        const alt = logo ? (brand ? `${brand} logo` : "Logo") : headings[0] ? `Picture for "${headings[0]}"` : words ? short(words, ALT_MAX) : "";
        slots.push({ id: str(p.id), role, headings: logo ? (brand ? [brand] : []) : headings, canBeDecorative: type !== "GridCard", fallback: { alt, decorative: false } });
      }
      const inside = type === "Section" ? sectionHeading(p.content) || enclosing : enclosing;
      for (const value of Object.values(p)) walk(value, inside);
    });
  };
  walk(data.content, "");
  return slots;
}

// ---- the model's part ------------------------------------------------------------------------------------------

const TOOL: ClaudeTool = {
  name: "suggest_alt_text",
  description: "Return a short description for each picture.",
  input_schema: {
    type: "object",
    properties: {
      descriptions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            id: { type: "string", description: "The id given for the picture." },
            alt: { type: "string", description: "The description, one plain sentence or phrase of at most 120 characters." },
            decorative: { type: "boolean", description: "True only when the picture adds nothing a reader needs and the picture's entry allows it." },
          },
          required: ["id", "alt"],
        },
      },
    },
    required: ["descriptions"],
  },
};

const SYSTEM = [
  "You write alt text (the description a screen reader says) for pictures on a marketing page of a community for writers.",
  "You are NOT shown the pictures and must not pretend to see them. For each picture you get its role on the page and the headings around it, which the staff wrote. Say plainly what the picture is for or most likely shows, from those headings only.",
  "Rules: at most 120 characters; no 'image of' or 'picture of' at the start; invent no people, names, places, colours or details; if the headings say little, describe its purpose (for example: Illustration for the waitlist section). A logo is the brand's name followed by 'logo'.",
  "Set decorative to true only for a picture that adds nothing for a reader and whose entry says it may be decorative; otherwise leave it out.",
  "Answer only by calling the suggest_alt_text tool, with one description per id given.",
].join("\n");

/** What goes to the model for these pictures: ids, roles and headings. Nothing else (see the privacy note above). */
export function promptFor(slots: PictureSlot[], brand: string): string {
  return JSON.stringify({ brand: brand || undefined, pictures: slots.map((s) => ({ id: s.id, role: s.role, mayBeDecorative: s.canBeDecorative, headings: s.headings })) });
}

/** One description from the model's answer, or null when it isn't usable. */
export function cleanAlt(raw: unknown): string | null {
  const text = clean(str(raw)).replace(/^(an? )?(image|picture|photo|photograph|graphic)( of| showing)\s+/i, "");
  if (!text) return null;
  const sentence = text.charAt(0).toUpperCase() + text.slice(1);
  return short(sentence, ALT_MAX);
}

/**
 * Suggestions for the pictures that need a description: the model's where it gave a usable one, the rules' own otherwise. `complete` is the model call
 * (a fake in tests); null means the model is not available. Returns why the model was not used, for the dialog to say.
 */
export async function suggestAltTexts(slots: PictureSlot[], data: LandingData, complete: Complete | null): Promise<{ suggestions: AltSuggestion[]; ai: "used" | "not_set_up" | "failed" }> {
  const fallback = (s: PictureSlot): AltSuggestion => ({ id: s.id, alt: s.fallback.alt, decorative: s.fallback.decorative, by: "fallback" });
  // A logo with a brand name needs no model: the name is the description.
  const needed = slots.filter((s) => !(s.role === "logo" && s.fallback.alt));
  if (!complete) return { suggestions: slots.map(fallback), ai: "not_set_up" };
  if (needed.length === 0) return { suggestions: slots.map(fallback), ai: "used" };
  let raw: unknown;
  try {
    raw = await complete(SYSTEM, promptFor(needed, brandOf(data)), TOOL);
  } catch (error) {
    // The message holds the status and never the key or the prompt.
    console.error("kajabi import alt text AI failed:", error instanceof Error ? error.message : String(error));
    return { suggestions: slots.map(fallback), ai: "failed" };
  }
  const answers = new Map<string, { alt: string; decorative: boolean }>();
  for (const entry of isObject(raw) && Array.isArray(raw.descriptions) ? raw.descriptions : []) {
    if (!isObject(entry)) continue;
    const slot = needed.find((s) => s.id === entry.id);
    const alt = cleanAlt(entry.alt);
    if (slot && alt && !answers.has(slot.id)) answers.set(slot.id, { alt, decorative: entry.decorative === true && slot.canBeDecorative });
  }
  return { suggestions: slots.map((s) => (answers.has(s.id) ? { id: s.id, ...answers.get(s.id)!, by: "ai" as const } : fallback(s))), ai: "used" };
}

/** The model call to use: Claude when it is set up, else none. */
export const defaultAltComplete = (): Complete | null => (aiConfigured() ? completeWithClaude : null);

// ---- writing what the admin reviewed -----------------------------------------------------------------------------

/** The admin's entries from the form, kept only for ids that were asked for, each cleaned. Anything else in the text is dropped. */
export function parseAltEntries(raw: unknown, allowed: Set<string>): Record<string, AltEntry> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 40_000) return {};
    try {
      value = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const out: Record<string, AltEntry> = {};
  if (!isObject(value)) return out;
  for (const [id, entry] of Object.entries(value)) {
    if (!allowed.has(id) || !isObject(entry)) continue;
    out[id] = { alt: short(clean(str(entry.alt)), ALT_MAX), decorative: entry.decorative === true };
  }
  return out;
}

/** Writes the reviewed descriptions into the blocks that hold the pictures; returns the document and how many pictures still have none. */
export function applyAltEntries(data: LandingData, entries: Record<string, AltEntry>, slots: PictureSlot[]): { data: LandingData; remaining: number } {
  const byId = new Map(slots.map((s) => [s.id, s]));
  let remaining = 0;
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!isObject(value)) return value;
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) out[key] = visit(inner);
    const id = isObject(out.props) ? str(out.props.id) : "";
    const slot = byId.get(id);
    if (slot && isObject(out.props)) {
      const entry = entries[id];
      if (entry?.decorative && slot.canBeDecorative) out.props = { ...out.props, alt: "", decorative: true };
      else if (entry?.alt) out.props = { ...out.props, alt: entry.alt, decorative: false };
      else remaining++;
    }
    return out;
  };
  return { data: visit(data) as LandingData, remaining };
}
