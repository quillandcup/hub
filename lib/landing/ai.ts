import { BACKGROUNDS, PADDING, WIDTHS } from "@/components/landing/theme";
import { BLOCK_DEFAULTS } from "@/components/landing/config";
import { ANTHROPIC } from "@/lib/config";
import { outboundFetch } from "@/lib/http/outbound";
import { checkLandingPage, type A11yIssue } from "./a11y";
import type { LandingData } from "./data";
import { PROMPT_MAX } from "./ai-limits";
import { sanitizeLandingData } from "./sanitize";

/**
 * "Build with AI" (docs/LANDING_PAGES.md): an admin describes a page and gets a draft. The model's answer is never
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


/** What the model may use. Excluded on purpose: Image and Split (need a picture), Testimonials (it would invent quotes), Countdown (a date), Video, CardGrid (pictures, prices), OptInForm (a Kajabi form id). */
export const AI_BLOCKS = ["Section", "Hero", "Heading", "RichText", "Button", "List", "Steps", "Stats", "Faq", "LinkList", "CtaBanner", "Divider", "Spacer"] as const;
type AiBlock = (typeof AI_BLOCKS)[number];

const LOOK = ["solid", "outline"];
const ALIGN = ["left", "center"];

/** The values a select prop takes, per block; a prop not listed is free text. */
const ENUMS: Record<string, Record<string, readonly string[]>> = {
  Section: { background: Object.keys(BACKGROUNDS), overlay: ["none", "dark", "light"], width: Object.keys(WIDTHS), padding: Object.keys(PADDING), align: ALIGN },
  RichText: { align: ALIGN },
  Heading: { level: ["h1", "h2", "h3"], align: ALIGN },
  Button: { look: LOOK, color: ["plum", "light", "brown"], shape: ["pill", "rect"], align: ALIGN },
  List: { align: ALIGN },
  LinkList: { look: LOOK, color: ["plum", "light", "brown"] },
  Divider: { look: ["short", "line"] },
  Spacer: { size: ["small", "medium", "large"] },
  Hero: { level: ["h1", "h2"], imageMode: ["background", "side"], overlay: ["none", "dark", "light"], background: Object.keys(BACKGROUNDS), align: ALIGN },
  CtaBanner: { background: Object.keys(BACKGROUNDS).filter((k) => k !== "none"), align: ALIGN },
};

const MAX_BLOCKS = 40;
const MAX_ITEMS = 12;
const MAX_TEXT = 1000;
const MAX_HTML = 8000;
/** Keys that hold a picture or a link to something the model can't know. */
const NEVER = /AssetId$/;

const isObject = (v: unknown): v is Props => Boolean(v) && typeof v === "object" && !Array.isArray(v);

function cleanValue(block: string, key: string, value: unknown, fallback: unknown): unknown {
  if (typeof fallback === "boolean") return typeof value === "boolean" ? value : fallback;
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
    indexBlocks(raw.props.content, into);
  }
  return into;
}

function cleanBlock(raw: unknown, depth: number, existing?: Existing): Block | null {
  if (!isObject(raw) || typeof raw.type !== "string") return null;
  const given = isObject(raw.props) ? raw.props : {};
  const id = typeof raw.id === "string" ? raw.id : typeof given.id === "string" ? given.id : undefined;
  const before = id ? existing?.get(id) : undefined;
  // A block the model cannot write (a picture, a video, a form) stays exactly as it is, or is removed by leaving it out.
  if (before && !(AI_BLOCKS as readonly string[]).includes(before.type)) return { type: before.type, props: before.props };
  if (!(AI_BLOCKS as readonly string[]).includes(raw.type)) return null;
  const type = raw.type as AiBlock;
  const cleaned = cleanObject(type, BLOCK_DEFAULTS[type] as unknown as Props, given);
  let props: Props;
  if (before && before.type === type) {
    // Only what the model sent changes; everything else (picture ids, other settings) is the page's own.
    props = { ...before.props };
    for (const key of Object.keys(cleaned)) if (key in given) props[key] = cleaned[key];
  } else {
    props = { id: newId(type), ...cleaned };
  }
  if (type === "Section") {
    // One level of nesting: a section holds blocks, not more sections.
    props.content = Array.isArray(given.content) && depth === 0 ? given.content.map((c) => cleanBlock(c, depth + 1, existing)).filter((b): b is Block => b !== null) : [];
  }
  return { type, props };
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
    const props = { ...(BLOCK_DEFAULTS[type] as unknown as Props) };
    const options = ENUMS[type] ? ` Options: ${Object.entries(ENUMS[type]).map(([k, v]) => `${k}=${v.join("|")}`).join("; ")}.` : "";
    return `- ${type}: props ${JSON.stringify(props)}.${options}${type === "Section" ? " Also `content`: a list of blocks inside it (not Sections)." : ""}`;
  }).join("\n");
}

export function systemPrompt(): string {
  return [
    "You build landing pages for Quill & Cup, a community for writers, in a block page builder. You answer only by calling the build_page tool.",
    "Write warm, plain, specific copy in the voice the request implies. Use only facts, prices, dates, names and links the request gives you; never invent figures, quotes, testimonials, deadlines or links. Where a fact is missing, write copy that does not need it, and leave a button's href empty so the admin fills it in.",
    "Structure: start with a Hero (its headline is the page's only h1; every other heading is h2 or h3, in order). Group related content in Sections with alternating backgrounds (none, cream, blush, plum), end with a CtaBanner. Keep it to what the request asks for, usually 4 to 8 top-level blocks.",
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

export type GenerateResult = { ok: true; data: LandingData; issues: A11yIssue[] } | { ok: false; error: string };

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
        max_tokens: 8000,
        system,
        tools: [TOOL],
        tool_choice: { type: "tool", name: TOOL.name },
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
    "landing-ai/1",
  );
  if (!response.ok) throw new Error(`Claude API answered ${response.status}`);
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
    if (!(AI_BLOCKS as readonly string[]).includes(raw.type)) return { id, type: raw.type, locked: true };
    const props: Props = {};
    for (const [key, value] of Object.entries(raw.props)) {
      if (key === "id" || NEVER.test(key)) continue;
      props[key] = key === "content" && Array.isArray(value) ? value.map(view).filter(Boolean) : value;
    }
    return { id, type: raw.type, props };
  };
  return (Array.isArray(content) ? content : []).map(view).filter(Boolean);
}

export const aiConfigured = (): boolean => Boolean(ANTHROPIC.apiKey);

/** Turns an admin's description into page data, ready to save as a draft. `complete` is the model call (a fake in tests). */
export async function generateLandingPage(prompt: string, complete: Complete = completeWithClaude): Promise<GenerateResult> {
  const text = prompt.trim();
  if (!text) return { ok: false, error: "Describe the page you want." };
  if (text.length > PROMPT_MAX) return { ok: false, error: `Keep the description under ${PROMPT_MAX} characters.` };
  let raw: unknown;
  try {
    raw = await complete(systemPrompt(), text);
  } catch (error) {
    // The message is for the logs only: it holds the status, never the key or the prompt.
    console.error("landing page AI build failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The page builder's assistant didn't answer. Nothing was created; try again." };
  }
  const data = cleanGeneratedBlocks(raw);
  if (!data) return { ok: false, error: "The assistant's answer had no usable page. Nothing was created; try again, or describe the page in more detail." };
  return { ok: true, data, issues: checkLandingPage(data) };
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
    raw = await complete(systemPrompt(), request);
  } catch (error) {
    console.error("landing page AI revision failed:", error instanceof Error ? error.message : String(error));
    return { ok: false, error: "The page builder's assistant didn't answer. The page is unchanged; try again." };
  }
  const data = cleanGeneratedBlocks(raw, current);
  if (!data) return { ok: false, error: "The assistant's answer had no usable page. The page is unchanged; try again." };
  return { ok: true, data, issues: checkLandingPage(data) };
}
