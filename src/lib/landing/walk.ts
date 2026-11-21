/**
 * Walking a page document by the shape of its blocks (`{ type, props }`), wherever they are nested (slots, zones). Shared by
 * the live-data resolver and the block registry's check for stored types nothing registers.
 */

export type StoredBlock = { type: string; props: Record<string, unknown> };

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const isBlock = (v: unknown): v is StoredBlock => isObject(v) && typeof v.type === "string" && isObject(v.props);

/** Every block in a document, nested ones (slots) and zones included. */
export function* blocksOf(value: unknown): Generator<StoredBlock> {
  if (Array.isArray(value)) for (const v of value) yield* blocksOf(v);
  else if (isObject(value)) {
    if (isBlock(value)) yield value;
    for (const v of Object.values(value)) yield* blocksOf(v);
  }
}

/** A copy of the document with `change` applied to the props of each block. */
export function mapBlocks(value: unknown, change: (block: StoredBlock) => Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => mapBlocks(v, change));
  if (!isObject(value)) return value;
  const mapped = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapBlocks(v, change)]));
  return isBlock(mapped) ? { ...mapped, props: change(mapped) } : mapped;
}
