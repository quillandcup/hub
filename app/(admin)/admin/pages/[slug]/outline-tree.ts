import type { ComponentData } from "@puckeditor/core";

/** What this reads of a Puck config: the blocks and their fields. Loose, so a real config and a small test one both fit. */
export type ConfigLike = { components: Record<string, unknown> };

/**
 * The page as the left panel's drill-down reads it: the sections of the page, and the blocks inside a block, found by
 * the config's own slot fields, so a block that gains a slot (a list of items, a new container) shows up here with no
 * change. Pure, so it is tested without Puck.
 */

/** Puck's name for the zone that holds the page's top level blocks (`rootAreaId:rootZone`). */
export const ROOT_ZONE = "root:default-zone";

/** One slot of a block: where the blocks inside it live, and which blocks it takes. */
export type SlotInfo = { key: string; label: string; allow?: string[]; disallow?: string[] };

/** One row of the drill-down: a block in a list. `container` blocks hold other blocks and drill into a list of their own. */
export type OutlineRow = { id: string; type: string; label: string; summary: string; container: boolean };

type SlotField = { type: "slot"; label?: string; allow?: string[]; disallow?: string[] };

/** The name for a slot with no label of its own: "Column 2" for `col2`, else the key. */
function slotLabel(key: string, label: string | undefined): string {
  if (label) return label;
  const column = /^col(\d+)$/.exec(key);
  return column ? `Column ${column[1]}` : key;
}

/** The slots a block type has, in field order. */
export function slotsOf(config: ConfigLike, type: string): SlotInfo[] {
  const fields = (config.components[type] as { fields?: Record<string, { type?: string }> } | undefined)?.fields ?? {};
  return Object.entries(fields)
    .filter(([, field]) => field?.type === "slot")
    .map(([key, field]) => {
      const slot = field as SlotField;
      return { key, label: slotLabel(key, slot.label), allow: slot.allow, disallow: slot.disallow };
    });
}

/** The names of the blocks a slot takes (or the page's top level, with `disallow` for what never sits there), in config order. */
export function allowedBlocks(config: ConfigLike, slot: { allow?: string[]; disallow?: string[] } | null, hiddenAtRoot: readonly string[] = []): string[] {
  const names = Object.keys(config.components);
  if (!slot) return names.filter((name) => !hiddenAtRoot.includes(name));
  return names.filter((name) => (slot.allow ? slot.allow.includes(name) : true) && !(slot.disallow ?? []).includes(name));
}

export function labelOf(config: ConfigLike, type: string): string {
  return (config.components[type] as { label?: string } | undefined)?.label ?? type;
}

const SUMMARY_KEYS = ["title", "heading", "headline", "text", "label", "question", "name", "value", "quote", "html"];
const SUMMARY_MAX = 36;

/** A few words from a block's own text, so two blocks of one kind can be told apart in the list. Empty when it has none. */
export function summaryOf(item: ComponentData): string {
  const props = item.props as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = props[key];
    if (typeof value !== "string") continue;
    const text = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
    if (text) return text.length > SUMMARY_MAX ? `${text.slice(0, SUMMARY_MAX - 1)}…` : text;
  }
  return "";
}

export function isContainer(config: ConfigLike, type: string): boolean {
  return slotsOf(config, type).length > 0;
}

export function rowOf(config: ConfigLike, item: ComponentData): OutlineRow {
  return { id: item.props.id, type: item.type, label: labelOf(config, item.type), summary: summaryOf(item), container: isContainer(config, item.type) };
}

/** The blocks in one of a block's slots. */
export function childrenIn(item: ComponentData, slotKey: string): ComponentData[] {
  const list = (item.props as Record<string, unknown>)[slotKey];
  return Array.isArray(list) ? (list as ComponentData[]) : [];
}

/** The zone name Puck uses for a block's slot. */
export const zoneOf = (parentId: string, slotKey: string) => `${parentId}:${slotKey}`;

/** Where one item went in a list, from the list before and after (what a drag or a menu choice returns). Null when nothing moved. */
export function moveOf(before: string[], after: string[]): { from: number; to: number } | null {
  if (before.length !== after.length) return null;
  let first = 0;
  while (first < before.length && before[first] === after[first]) first++;
  if (first === before.length) return null;
  let last = before.length - 1;
  while (before[last] === after[last]) last--;
  // One item moved: it is `before[first]` when it went down to `last`, else `before[last]` when it came up to `first`.
  if (after[last] === before[first]) return { from: first, to: last };
  if (after[first] === before[last]) return { from: last, to: first };
  return null;
}

/** The block with this id, found by walking the page's top level and the slots of every block. */
export function findItem(config: ConfigLike, content: ComponentData[], id: string): ComponentData | undefined {
  for (const item of content) {
    if (item.props.id === id) return item;
    for (const slot of slotsOf(config, item.type)) {
      const found = findItem(config, childrenIn(item, slot.key), id);
      if (found) return found;
    }
  }
  return undefined;
}
