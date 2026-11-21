import type { ReactNode } from "react";
import { blocksOf } from "@/lib/landing/walk";

/**
 * The page block registry: every block the page builder offers is one `PageBlockDefinition`, contributed by the pages code
 * itself (`core-blocks.ts`) or by a module installed in the composition root (`src/modules/index.ts`). The editor's config, the
 * public renderer, the publish check, the AI builder and the JSON import all read the registry; none of them names a block
 * that a module owns, and the pages code never imports a module (`config/eslint.mjs` fails the build if it does).
 * See docs/architecture/PAGE_BLOCKS.md for how to add a block or a contribution.
 *
 * This file is plain data and functions with no editor and no server code, so the public page, the editor and the tests share it.
 * What only one side may load is a separate contribution of its own: editor fields (`editor-kit.tsx`, a client bundle that
 * carries TipTap and the media picker) and live data loaders (`lib/landing/live-data.ts`, server only).
 */

/** The palette's groups, in the order the editor lists them. `parts` is filled from the blocks that sit inside another block's list. */
export const PAGE_BLOCK_CATEGORIES = {
  layout: "Layout",
  ready_made: "Ready-made",
  parts: "Parts of a block",
  homepage: "Homepage",
  content: "Content",
  links: "Links",
} as const;
export type PageBlockCategory = keyof typeof PAGE_BLOCK_CATEGORIES;

/** What a block's `publishCheck` can say about the page (src/lib/landing/a11y.ts supplies it). */
export type PublishCheckTools = {
  str: (value: unknown) => string;
  rows: (value: unknown) => Record<string, unknown>[];
  /** A heading the block draws, for the check that levels go down one step at a time. */
  heading: (level: number, text: string) => void;
  /** A button or link with words but no usable address is an error; one that says only "click here" a warning. */
  checkButton: (block: string, label: unknown, href: unknown, what?: string) => void;
};

/** How the publish check treats a block whose list is a slot of item blocks: what to call them and which prop shows an item is filled in. */
export type PageBlockItemRule = {
  /** The block's name in a message ("Schedule panel"). */
  block: string;
  noun: string;
  plural: string;
  /** The type of the item block. */
  item: string;
  /** The item prop the public page needs before it draws the item. */
  key: string;
  /** A block that falls back to its items only when live data fails: having none is not worth a warning while it is live. */
  liveOk?: boolean;
  shown?: (props: Record<string, unknown>) => boolean;
};

export type PageBlockDefinition = {
  /** The name the block is stored under in page JSON. Never rename one: stored pages carry it. */
  type: string;
  /** What the palette calls it. */
  label: string;
  category: PageBlockCategory;
  /** Position inside its palette group (lower first; ties keep registration order). Contributions leave gaps so a module's block can sit between two core ones. */
  order: number;
  /** The props a freshly added block starts with. A slot starts empty unless the defaults give it items. */
  defaults: Readonly<Record<string, unknown>>;
  /** The block's component. Loosely typed, like Puck's own config, because each block types its own props. */
  render: (props: never) => ReactNode;
  /** The slots (lists of child blocks) the block holds, by name; `allow` limits what a slot takes (the item blocks of a list). */
  slots?: Readonly<Record<string, { allow?: readonly string[] }>>;
  /** The most items its `items` slot is laid out for; more are hidden on the public page and the publish check says so. */
  itemLimit?: number;
  itemRule?: PageBlockItemRule;
  /** Extra publish checks for this block (alt text, links, headings); the generic ones live in the check itself. */
  publishCheck?: (props: Record<string, unknown>, tools: PublishCheckTools) => void;
};

/** What a module (or the pages code) adds: a name for error messages, and the blocks. */
export type PageBlockContribution = { id: string; blocks: readonly PageBlockDefinition[] };

/** Declares a block. It is the identity at run time; its job is to make a definition typed and to be the one thing to grep for. */
export const definePageBlock = <T extends PageBlockDefinition>(definition: T): T => definition;

export type PageBlockRegistry = {
  /** The ids of the contributions it was built from, in order. */
  contributions: readonly string[];
  blocks: readonly PageBlockDefinition[];
  get: (type: string) => PageBlockDefinition | undefined;
  has: (type: string) => boolean;
  /** Which contribution registered a type. */
  ownerOf: (type: string) => string | undefined;
  defaults: Record<string, Readonly<Record<string, unknown>>>;
  labels: Record<string, string>;
  /** Every slot of every block, by name (a Section's `content`, a Steps block's `items`). */
  slots: Record<string, string[]>;
  /** Of the blocks whose slots take only some types, which. */
  slotAllow: Record<string, Record<string, string[]>>;
  /** The blocks that only make sense inside another block's list ("Parts of a block"). */
  itemBlocks: string[];
  itemLimits: Record<string, number>;
  itemRules: Record<string, PageBlockItemRule & { limit?: number }>;
  /** The block type that holds each item type. */
  itemParents: Record<string, string>;
  categories: Record<PageBlockCategory, { title: string; components: string[] }>;
};

/**
 * Builds the registry from contributions, in order. It throws, naming both owners, when two blocks share a type, and when a
 * definition is unusable (no label, no component, a slot that allows a type nothing registers, a "part" nobody holds), so a
 * wrong contribution fails at startup and in the registry tests, not as a block that quietly goes missing.
 */
export function createPageBlockRegistry(contributions: readonly PageBlockContribution[]): PageBlockRegistry {
  const owners = new Map<string, string>();
  const byType = new Map<string, PageBlockDefinition>();
  const blocks: PageBlockDefinition[] = [];
  for (const contribution of contributions) {
    if (!contribution.id) throw new Error("A page block contribution needs an id.");
    for (const block of contribution.blocks) {
      const where = `Page block "${block.type}" (from "${contribution.id}")`;
      if (!block.type || !/^[A-Za-z][A-Za-z0-9]*$/.test(block.type)) throw new Error(`${where} needs a type made of letters and digits.`);
      if (owners.has(block.type)) throw new Error(`${where} is already registered by "${owners.get(block.type)}".`);
      if (!block.label) throw new Error(`${where} needs a label.`);
      if (typeof block.render !== "function") throw new Error(`${where} needs a render component.`);
      if (!block.defaults || typeof block.defaults !== "object") throw new Error(`${where} needs default props.`);
      if (!(block.category in PAGE_BLOCK_CATEGORIES)) throw new Error(`${where} is in the unknown palette group "${block.category}".`);
      owners.set(block.type, contribution.id);
      byType.set(block.type, block);
      blocks.push(block);
    }
  }

  const slots: Record<string, string[]> = {};
  const slotAllow: Record<string, Record<string, string[]>> = {};
  const itemLimits: Record<string, number> = {};
  const itemRules: PageBlockRegistry["itemRules"] = {};
  const itemParents: Record<string, string> = {};
  const held = new Set<string>();
  for (const block of blocks) {
    if (block.slots) {
      slots[block.type] = Object.keys(block.slots);
      for (const [slot, { allow }] of Object.entries(block.slots)) {
        if (!allow) continue;
        for (const type of allow) {
          if (!byType.has(type)) throw new Error(`Page block "${block.type}" (from "${owners.get(block.type)}") takes "${type}" in its "${slot}" slot, which no contribution registers.`);
          held.add(type);
        }
        (slotAllow[block.type] ??= {})[slot] = [...allow];
      }
    }
    if (block.itemLimit !== undefined) itemLimits[block.type] = block.itemLimit;
    if (block.itemRule) {
      itemRules[block.type] = { ...block.itemRule, ...(block.itemLimit !== undefined ? { limit: block.itemLimit } : {}) };
      itemParents[block.itemRule.item] = block.type;
    }
  }
  const inPalette = (types: Iterable<string>) => [...types].map((type, i) => ({ type, key: byType.get(type)!.order, i })).sort((a, b) => a.key - b.key || a.i - b.i).map((b) => b.type);
  const itemBlocks = inPalette(held);
  for (const block of blocks) {
    const isPart = held.has(block.type);
    if (isPart && block.category !== "parts") throw new Error(`Page block "${block.type}" sits inside another block's list, so its group must be "parts".`);
    if (!isPart && block.category === "parts") throw new Error(`Page block "${block.type}" is a "part" but no block's slot takes it.`);
  }

  const categories = Object.fromEntries(
    (Object.keys(PAGE_BLOCK_CATEGORIES) as PageBlockCategory[]).map((category) => {
      const inGroup = category === "parts" ? itemBlocks : inPalette(blocks.filter((b) => b.category === category).map((b) => b.type));
      return [category, { title: PAGE_BLOCK_CATEGORIES[category], components: inGroup }];
    }),
  ) as PageBlockRegistry["categories"];

  return {
    contributions: contributions.map((c) => c.id),
    blocks,
    get: (type) => byType.get(type),
    has: (type) => byType.has(type),
    ownerOf: (type) => owners.get(type),
    defaults: Object.fromEntries(blocks.map((b) => [b.type, b.defaults])),
    labels: Object.fromEntries(blocks.map((b) => [b.type, b.label])),
    slots,
    slotAllow,
    itemBlocks,
    itemLimits,
    itemRules,
    itemParents,
    categories,
  };
}

/**
 * The block types a stored page uses that this registry does not have (a module that is not installed, or was removed). The page
 * stays as stored: the editor and the renderer register a placeholder for each of these (`block-placeholder.tsx`) instead of crashing.
 */
export function unregisteredTypes(data: unknown, registry: Pick<PageBlockRegistry, "has">): string[] {
  const missing = new Set<string>();
  for (const block of blocksOf(data)) if (!registry.has(block.type)) missing.add(block.type);
  return [...missing].sort();
}
