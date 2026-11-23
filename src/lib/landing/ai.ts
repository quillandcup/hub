import { BACKGROUNDS, PADDING, WIDTHS } from "@/components/landing/theme";
import { BLOCK_DEFAULTS, SLOT_ALLOW, SLOTS } from "@/components/landing/config";
import { ANTHROPIC } from "@/lib/config";
import { outboundFetch } from "@/lib/http/outbound";
import { checkLandingPage, type A11yIssue } from "./a11y";
import type { LandingData } from "./data";
import { clampSpace, clampSpan } from "./layout";
import { PROMPT_MAX } from "./ai-limits";
import { sanitizeLandingData } from "./sanitize";

/**
 * "Build with AI" (docs/product/LANDING_PAGES.md): an admin describes a page and gets a draft. The model's answer is never
 * trusted: it is reduced to the blocks and props the builder has, every value is checked against the block's own
 * defaults and option lists, and the result goes through `sanitizeLandingData` like anything an admin types. It is saved
 * as a draft, never published, so an admin always reads it first.
 *
 * Only the admin's description goes to the model. No member data, no existing page, no picture. Blocks that need a
 * thing the model cannot know (a picture from the media library, a Kajabi form id, a date, a video, a person's quote)
 * are not offered to it.
 */

type Props = Record<string, unknown>;
type Block = { type: string; props: Props };


/** What the model may use. Excluded on purpose: Image and Split (need a picture), Testimonials (it would invent quotes), Countdown (a date), Video, OptInForm (a Kajabi form id). CardGrid is offered without pictures, prices or buttons. */
export const AI_BLOCKS = ["Section", "Hero", "Heading", "RichText", "Button", "List", "Steps", "Stats", "Faq", "LinkList", "CtaBanner", "CardGrid", "Divider", "Spacer"] as const;
type AiBlock = (typeof AI_BLOCKS)[number];
/** The blocks the model writes inside one of those: the items of Steps, Stats, List, FAQ, Link list and Card grid. They are only ever offered in their parent's list, never on their own. */
const AI_ITEMS = ["Step", "Stat", "ListItem", "FaqQuestion", "LinkItem", "GridCard"] as const;
const WRITABLE: readonly string[] = [...AI_BLOCKS, ...AI_ITEMS];

const LOOK = ["inherit", "solid", "outline"];
const ALIGN = ["left", "center"];

/** The values a select prop takes, per block; a prop not listed is free text. */
const ENUMS: Record<string, Record<string, readonly string[]>> = {
  Section: { background: Object.keys(BACKGROUNDS), overlay: ["none", "dark", "light"], width: Object.keys(WIDTHS), align: ALIGN },
  RichText: { align: ALIGN },
  Heading: { level: ["h1", "h2", "h3"], align: ALIGN },
  Button: { look: LOOK, color: ["plum", "light", "brown"], shape: ["pill", "rect"], align: ALIGN },
  List: { align: ALIGN },
  LinkItem: { look: LOOK, color: ["plum", "light", "brown"] },
  Divider: { look: ["short", "line"] },
  Spacer: { size: ["small", "medium", "large"] },
  Hero: { level: ["h1", "h2"], imageMode: ["background", "side"], overlay: ["none", "dark", "light"], background: Object.keys(BACKGROUNDS), align: ALIGN, padding: Object.keys(PADDING) },
  CtaBanner: { background: Object.keys(BACKGROUNDS).filter((k) => k !== "none"), align: ALIGN },
  CardGrid: { columns: ["2", "3", "4"] },
};

/** What the model is shown and may set for a block: the builder's defaults, except where those are sample content (a card's price and "Buy now"). */
const { hideOnDesktop: _hideOnDesktop, hideOnMobile: _hideOnMobile, cardColor: _cardColor, cardSoft: _cardSoft, place: _place, textTone: _textTone, fill: _fill, ...SECTION_SHAPE } = BLOCK_DEFAULTS.Section;
const SHAPES: Partial<Record<AiBlock | (typeof AI_ITEMS)[number], Props>> = {
  // The items of these are child blocks (`SLOT_ALLOW`), described beside the props.
  Steps: { heading: BLOCK_DEFAULTS.Steps.heading },
  Stats: {},
  List: { align: BLOCK_DEFAULTS.List.align },
  Faq: {},
  LinkList: {},
  CardGrid: { columns: "3" },
  // Spacing as numbers (px) for desktop and mobile. The model is not offered hiding a section or filling the page: those are the admin's call.
  Section: SECTION_SHAPE,
  // A card is offered without a picture, a price or a button: the request rarely gives them, and the model must not invent them.
  GridCard: { icon: "", title: "", description: "", price: "", buttonLabel: "", href: "" },
};
const shapeOf = (type: AiBlock | (typeof AI_ITEMS)[number]): Props => SHAPES[type as keyof typeof SHAPES] ?? (BLOCK_DEFAULTS[type] as unknown as Props);

/** A card grid with a picture on any card stays as it is: the model never sees pictures, so it could not keep them. */
const hasPictures = (block: Block): boolean =>
  block.type === "CardGrid" && Array.isArray(block.props.items) && block.props.items.some((i) => isObject(i) && isObject(i.props) && typeof i.props.imageAssetId === "string" && i.props.imageAssetId !== "");

const MAX_BLOCKS = 40;
const MAX_ITEMS = 12;
const MAX_TEXT = 1000;
const MAX_HTML = 8000;
/** Keys that hold a picture or a link to something the model can't know. */
const NEVER = /AssetId$/;

const isObject = (v: unknown): v is Props => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function cleanValue(block: string, key: string, value: unknown, fallback: unknown): unknown {
  if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback;
  if (typeof fallback === "number") return typeof value === "number" ? clampSpace(value, fallback) : fallback;
  if (typeof fallback === "string") {
    if (typeof value !== "string") return fallback;
    const allowed = ENUMS[block]?.[key];
    if (allowed) return allowed.includes(value) ? value : fallback;
    return value.slice(0, key === "html" ? MAX_HTML : MAX_TEXT);
  }
  if (Array.isArray(fallback)) {
    const shape = fallback[0];
    if (!Array.isArray(value) || !isObject(shape)) return fallback;
    return value
      .filter(isObject)
      .slice(0, MAX_ITEMS)
      .map((item) => cleanObject(block, shape, item));
  }
  if (isObject(fallback)) return isObject(value) ? cleanObject(block, fallback, value) : fallback;
  return fallback;
}

function cleanObject(block: string, shape: Props, value: Props): Props {
  const out: Props = {};
  for (const [key, fallback] of Object.entries(shape)) if (!NEVER.test(key)) out[key] = cleanValue(block, key, value[key], fallback);
  return out;
}

let counter = 0;
const newId = (type: string) => `${type}-ai${Date.now().toString(36)}${(counter++).toString(36)}`;

/** Blocks already on the page, by id, so a revision keeps what the model was not shown (pictures) and what it must not change. */
type Existing = Map<string, Block>;

function indexBlocks(content: unknown, into: Existing = new Map()): Existing {
  if (!Array.isArray(content)) return into;
  for (const raw of content) {
    if (!isObject(raw) || typeof raw.type !== "string" || !isObject(raw.props)) continue;
    if (typeof raw.props.id === "string") into.set(raw.props.id, { type: raw.type, props: raw.props });
    // Nested blocks sit in a slot of any name (a Section's `content`, a Steps block's `items`).
    for (const value of Object.values(raw.props)) if (Array.isArray(value)) indexBlocks(value, into);
  }
  return into;
}

/** `allow` is what the list this block is in takes: the page's blocks by default, or the item type of a Steps or Stats block (`inItems`). */
function cleanBlock(raw: unknown, depth: number, existing?: Existing, allow: readonly string[] = AI_BLOCKS, inItems = false): Block | null {
  if (!isObject(raw) || typeof raw.type !== "string") return null;
  const given = isObject(raw.props) ? raw.props : {};
  const id = typeof raw.id === "string" ? raw.id : typeof given.id === "string" ? given.id : undefined;
  const before = id ? existing?.get(id) : undefined;
  // A block the model cannot write (a picture, a video, a form) stays exactly as it is, or is removed by leaving it out.
  if (before && (!WRITABLE.includes(before.type) || hasPictures(before))) return { type: before.type, props: before.props };
  if (!allow.includes(raw.type)) return null;
  const type = raw.type as AiBlock;
  const cleaned = cleanObject(type, shapeOf(type), given);
  let props: Props;
  if (before && before.type === type) {
    // Only what the model sent changes; everything else (picture ids, other settings) is the page's own.
    props = { ...before.props };
    for (const key of Object.keys(cleaned)) if (key in given) props[key] = cleaned[key];
  } else {
    props = { id: newId(type), ...cleaned };
  }
  if (depth > 0 && !inItems) {
    // A block inside a Section may take part of its 12 columns (`span` on desktop, `spanMobile` on mobile); anything but 1 to 12 means the full width.
    for (const key of ["span", "spanMobile"]) {
      if (!(key in given)) continue;
      const columns = clampSpan(given[key]);
      if (columns === undefined) delete props[key];
      else props[key] = columns;
    }
  }
  if (type === "Section") {
    // One level of nesting: a section holds blocks, not more sections.
    // Models put the children in props.content as asked, or beside props; both are read.
    const kids = Array.isArray(given.content) ? given.content : Array.isArray(raw.content) ? raw.content : [];
    props.content = depth === 0 ? kids.map((c) => cleanBlock(c, depth + 1, existing)).filter((b): b is Block => b !== null) : [];
  }
  // The items of a block that holds a list (Steps, Stats, List, FAQ, Link list, Card grid): child blocks of the one type its list takes, written in `props.items` (or beside props, as with a Section's).
  for (const [slot, types] of Object.entries(SLOT_ALLOW[type] ?? {})) {
    if (before && before.type === type && !(slot in given) && !(slot in raw)) continue;
    const kids = Array.isArray(given[slot]) ? given[slot] : Array.isArray(raw[slot]) ? raw[slot] : [];
    // A bare `{ "title": ..., "text": ... }` is read as one item of the list's type, the shorthand models reach for.
    const asBlock = (c: unknown) => (isObject(c) && typeof c.type !== "string" ? { type: types[0], props: c } : c);
    props[slot] = kids.slice(0, MAX_ITEMS).map((c) => cleanBlock(asBlock(c), depth + 1, existing, types, true)).filter((b): b is Block => b !== null);
  }
  return { type, props };
}

/** The model's one-line account of what it did; plain text, short. */
export function cleanSummary(raw: unknown): string | undefined {
  const text = isObject(raw) && typeof raw.summary === "string" ? raw.summary.replace(/\s+/g, " ").trim().slice(0, 300) : "";
  return text || undefined;
}

/** The problems in `after` that `before` did not already have, so a change is not blamed for what was on the page already. */
export function newIssues(after: A11yIssue[], before: A11yIssue[]): A11yIssue[] {
  const seen = new Map<string, number>();
  for (const i of before) seen.set(`${i.severity}|${i.message}`, (seen.get(`${i.severity}|${i.message}`) ?? 0) + 1);
  return after.filter((i) => {
    const key = `${i.severity}|${i.message}`;
    const left = seen.get(key) ?? 0;
    if (left > 0) seen.set(key, left - 1);
    return left === 0;
  });
}

/** What the model returned, reduced to blocks the builder has. Anything else is dropped; `null` when nothing usable is left. */
export function cleanGeneratedBlocks(raw: unknown, current?: unknown): LandingData | null {
  if (!isObject(raw) || !Array.isArray(raw.blocks)) return null;
  const existing = current === undefined ? undefined : indexBlocks(current);
  const content = raw.blocks.slice(0, MAX_BLOCKS).map((b) => cleanBlock(b, 0, existing)).filter((b): b is Block => b !== null);
  if (content.length === 0) return null;
  return sanitizeLandingData({ content, root: {} });
}

function describeBlocks(): string {
  return AI_BLOCKS.map((type) => {
    const props = { ...shapeOf(type) };
    const options = ENUMS[type] ? ` Options: ${Object.entries(ENUMS[type]).map(([k, v]) => `${k}=${v.join("|")}`).join("; ")}.` : "";
    const items = Object.values(SLOT_ALLOW[type] ?? {})[0]?.[0];
    const itemNote = items ? ` Also \`items\`: a list of ${items} blocks, each {"type": "${items}", "props": ${JSON.stringify(shapeOf(items as (typeof AI_ITEMS)[number]))}}.` : "";
    return `- ${type}: props ${JSON.stringify(props)}.${options}${type === "Section" ? " Also `content`: a list of blocks inside it (not Sections)." : ""}${itemNote}`;
  }).join("\n");
}

/** What the request is: a whole new page, blocks to add to a page that exists, or a change to the page that exists. */
export type Task = "page" | "add" | "change";

const TASK_RULES: Record<Task, string> = {
  page: "Structure: start with a Hero (its headline is the page's only h1; every other heading is h2 or h3, in order). Group related content in Sections with alternating backgrounds (none, cream, blush, plum), end with a CtaBanner. Keep it to what the request asks for, usually 4 to 8 top-level blocks.",
  add: "You are adding to a page that already has its own hero and call to action. Return only the blocks the request asks for, and nothing around them: no Hero, no CtaBanner, no h1 (headings are h2 or h3). Usually one Section holding the content, or a few blocks.",
  change: "You are changing a page that already exists. Return the complete revised page, change only what is asked, and leave everything else exactly as it is.",
};

export function systemPrompt(task: Task = "page"): string {
  return [
    "You build landing pages for Quill & Cup, a community for writers, in a block page builder. You answer only by calling the build_page tool.",
    "Write warm, plain, specific copy in the voice the request implies. Use only facts, prices, dates, names and links the request gives you; never invent figures, quotes, testimonials, deadlines or links. Where a fact is missing, write copy that does not need it, and leave a button's href empty so the admin fills it in.",
    TASK_RULES[task],
    "A Section's blocks go in its props.content list. The entries of a Steps, Stats, List, FAQ, Link list or Card grid block go in its props.items list, each as a block of the item type given for it below. For a short set of parallel points with icons, use a List: each item's `icon` is one fitting emoji and its `text` is one or two short sentences (start with the point's name when it has one).",
    "For cards side by side (pillars, offers, features), use a CardGrid: each card has an `icon` (one fitting emoji), a `title` and a short `description`; leave price, buttonLabel and href empty unless the request gives them.",
    "Spacing: a Section's paddingDesktop and paddingMobile are the space inside it in px (top, bottom, left, right; 0 to 320). The defaults suit most sections: change them only when asked, or for an airy opening or closing band. Width: the blocks inside a Section sit on a 12-column grid. Give a block `span` (1 to 12: its width on desktop) and, if it should differ on a phone, `spanMobile` (full width when left out) to put blocks side by side, for example two Buttons with span 6, or a Heading and some text with span 5 and 7. Leave both out for full width.",
    "Rich text (`html`) may use only p, h2, h3, ul, ol, li, strong, em, a and blockquote. There are no pictures: leave picture props out. Never mention AI.",
    "Blocks and their props (each prop you set must be one of these, with a value of the same kind):",
    describeBlocks(),
    "Each block you return is {\"type\": <name>, \"props\": {...}}; props you leave out take their defaults.",
  ].join("\n");
}

const TOOL = {
  name: "build_page",
  description: "Return the page as a list of blocks.",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "One plain sentence saying what you did, for the admin (for example: Shortened the intro and turned the steps into a list)." },
      blocks: {
        type: "array",
        description: "The page's blocks, top to bottom.",
        items: {
          type: "object",
          properties: { id: { type: "string", description: "Only when keeping or changing a block that is on the page now." }, type: { type: "string", enum: Object.keys(BLOCK_DEFAULTS), description: "Only the blocks listed in the instructions, except to keep a locked block already on the page: then give its own type and id with props {}." }, props: { type: "object" } },
          required: ["type", "props"],
        },
      },
    },
    required: ["blocks"],
  },
} as const;

export type GenerateResult = { ok: true; data: LandingData; issues: A11yIssue[]; summary?: string } | { ok: false; error: string };

export type Complete = (system: string, prompt: string) => Promise<unknown>;

const TIMEOUT_MS = 100_000;

/** One call to the Claude API with the build_page tool forced; resolves to the tool's input. Throws on any failure. */
export const completeWithClaude: Complete = async (system, prompt) => {
  const response = await outboundFetch(
    `${ANTHROPIC.apiUrl}/v1/messages`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": ANTHROPIC.apiKey as string, "anthropic-version": ANTHROPIC.apiVersion },
      body: JSON.stringify({
        model: ANTHROPIC.landingPageModel,
        // Thinking tokens count against this, so there is room for both.
        max_tokens: 16000,
        // Medium effort: Sonnet follows layout requests well at this level, at a fraction of the cost and wait of higher ones.
        output_config: { effort: "medium" },
        thinking: { type: "adaptive" },
        system,
        tools: [TOOL],
        // This model rejects a forced tool choice (400), so the instructions say to answer only by calling the tool.
        tool_choice: { type: "auto" },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    "landing-ai/1",
  );
  if (!response.ok) {
    // Anthropic's error message says what was wrong with the request; it never holds the key or our prompt.
    const detail = (await response.json().catch(() => undefined)) as { error?: { type?: string; message?: string } } | undefined;
    throw new Error(`Claude API answered ${response.status}${detail?.error ? `: ${detail.error.type ?? "error"}: ${String(detail.error.message ?? "").slice(0, 300)}` : ""}`);
  }
  const body = (await response.json()) as { content?: { type: string; input?: unknown }[] };
  const call = body.content?.find((c) => c.type === "tool_use");
  if (!call) throw new Error("Claude API returned no tool call");
  return call.input;
};

const REVISE_MAX = 60_000;

/** The page as the model sees it: ids and the props it may change; no picture ids; blocks it cannot write are marked locked. */
export function pageForModel(content: unknown): unknown[] {
  const view = (raw: unknown): unknown => {
    if (!isObject(raw) || typeof raw.type !== "string" || !isObject(raw.props)) return null;
    const id = raw.props.id;
    if (!WRITABLE.includes(raw.type) || hasPictures({ type: raw.type, props: raw.props })) return { id, type: raw.type, locked: true };
    const slots = SLOTS[raw.type as keyof typeof SLOTS] ?? [];
    const props: Props = {};
    for (const [key, value] of Object.entries(raw.props)) {
      if (key === "id" || NEVER.test(key)) continue;
      props[key] = slots.includes(key) && Array.isArray(value) ? value.map(view).filter(Boolean) : value;
    }
    return { id, type: raw.type, props };
  };
  return (Array.isArray(content) ? content : []).map(view).filter(Boolean);
}

export const aiConfigured = (): boolean => Boolean(ANTHROPIC.apiKey);

/** Turns an admin's description into page data, ready to save as a draft. `complete` is the model call (a fake in tests). */
export async function generateLandingPage(prompt: string, complete: Complete = completeWithClaude, task: Task = "page"): Promise<GenerateResult> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: "Describe the page you want." };
  if (text.length > PROMPT_MAX) return { ok: false, error: `Keep the description under ${PROMPT_MAX} characters.` };
  let raw: unknown;
  try {
    raw = await complete(systemPrompt(task), text);
  } catch (error) {
    // The message is for the logs only: it holds the status, never the key or the prompt.
    console.error("landing page AI build failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The page builder's assistant didn't answer. Nothing was created; try again." };
  }
  const data = cleanGeneratedBlocks(raw);
  if (!data) return { ok: false, error: "The assistant's answer had no usable page. Nothing was created; try again, or describe the page in more detail." };
  // Blocks added to a page are not a page: "needs a title" is about the page they are going into.
  const issues = checkLandingPage(data).filter((i) => task !== "add" || i.block !== "Page");
  return { ok: true, data, issues, summary: cleanSummary(raw) };
}

/**
 * Changes the page being edited as the admin describes ("shorter", "add an FAQ", "make the buttons outline"). The model
 * gets the page's blocks (no picture ids) and returns the whole revised list; blocks keep their ids, so pictures and
 * settings it did not touch stay. Blocks it cannot write are kept as they are or removed, never altered.
 */
export async function reviseLandingPage(prompt: string, current: unknown, complete: Complete = completeWithClaude): Promise<GenerateResult> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: "Describe the change you want." };
  if (text.length > PROMPT_MAX) return { ok: false, error: `Keep the description under ${PROMPT_MAX} characters.` };
  if (!Array.isArray(current) || current.length === 0) return { ok: false, error: "The page has nothing to change yet. Use Add to the page." };
  const view = JSON.stringify(pageForModel(current));
  if (view.length > REVISE_MAX) return { ok: false, error: "This page is too long to change in one go. Ask about one part of it, or add blocks instead." };
  const request = `Here is the page as it is now (blocks keep their id; "locked" blocks cannot be changed by you, only kept or dropped):\n${view}\n\nChange it as follows, and return the complete revised page, keeping the id of every block you keep or change and giving new blocks no id. Change only what is asked; leave everything else as it is.\n\n${text}`;
  let raw: unknown;
  try {
    raw = await complete(systemPrompt("change"), request);
  } catch (error) {
    console.error("landing page AI revision failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The page builder's assistant didn't answer. The page is unchanged; try again." };
  }
  const data = cleanGeneratedBlocks(raw, current);
  if (!data) return { ok: false, error: "The assistant's answer had no usable page. The page is unchanged; try again." };
  // Only what the change introduced: the page's old problems are the admin's to know already, and not repeated here.
  const before = checkLandingPage({ content: current as never[], root: {} } as LandingData);
  return { ok: true, data, issues: newIssues(checkLandingPage(data), before), summary: cleanSummary(raw) };
}
