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

function cleanBlock(raw: unknown, depth: number): Block | null {
  if (!isObject(raw) || typeof raw.type !== "string" || !(AI_BLOCKS as readonly string[]).includes(raw.type)) return null;
  const type = raw.type as AiBlock;
  const given = isObject(raw.props) ? raw.props : {};
  const props = cleanObject(type, BLOCK_DEFAULTS[type] as unknown as Props, given);
  if (type === "Section") {
    // One level of nesting: a section holds blocks, not more sections.
    const children = Array.isArray(given.content) && depth === 0 ? given.content.map((c) => cleanBlock(c, depth + 1)).filter((b): b is Block => b !== null) : [];
    props.content = children;
  }
  return { type, props: { id: newId(type), ...props } };
}

/** What the model returned, reduced to blocks the builder has. Anything else is dropped; `null` when nothing usable is left. */
export function cleanGeneratedBlocks(raw: unknown): LandingData | null {
  if (!isObject(raw) || !Array.isArray(raw.blocks)) return null;
  const content = raw.blocks.slice(0, MAX_BLOCKS).map((b) => cleanBlock(b, 0)).filter((b): b is Block => b !== null);
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
          properties: { type: { type: "string", enum: [...AI_BLOCKS] }, props: { type: "object" } },
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
