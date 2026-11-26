/**
 * The metadata Kajabi writes on the Stripe charges and subscriptions it creates. Two shapes exist:
 * - `kjb_offer_id` (September 2022 to August 2026): the Kajabi offer id.
 * - `platform_product_ID` (from July 2026, no `kjb_offer_id`): also the Kajabi offer id. Its sibling
 *   `platform_order_ID` is NOT a Kajabi purchase id and is never used.
 * One place knows both, so the repository query, the in-memory fake and the loader cannot drift apart.
 */

/** The metadata keys that carry the Kajabi offer id, in order of preference. */
export const KAJABI_OFFER_ID_METADATA_KEYS = ["kjb_offer_id", "platform_product_ID"] as const;

/** The metadata object of a raw Stripe record, or null. */
function metadataOf(data: unknown): Record<string, unknown> | null {
  const metadata = data && typeof data === "object" ? (data as { metadata?: unknown }).metadata : null;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as Record<string, unknown>) : null;
}

/** The Kajabi offer id in a raw Stripe record's metadata: `kjb_offer_id`, else `platform_product_ID`; null when neither is a string. */
export function kajabiOfferIdOf(data: unknown): string | null {
  const metadata = metadataOf(data);
  if (!metadata) return null;
  for (const key of KAJABI_OFFER_ID_METADATA_KEYS) {
    const value = metadata[key];
    if (typeof value === "string") return value;
  }
  return null;
}

/** True when the metadata has any key Kajabi writes (`kjb_` or `platform_` prefix). */
export function hasKajabiMetadata(data: unknown): boolean {
  const metadata = metadataOf(data);
  return metadata !== null && Object.keys(metadata).some((key) => key.startsWith("kjb_") || key.startsWith("platform_"));
}

/** How many raw records look like Kajabi's (Kajabi metadata keys) but carry no offer id in a shape we know: the purchases behind them would show as missing a payment. */
export function countUnrecognisedKajabiMetadata(records: Array<{ data: unknown }>): number {
  return records.filter((r) => hasKajabiMetadata(r.data) && kajabiOfferIdOf(r.data) === null).length;
}
