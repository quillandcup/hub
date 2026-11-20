/**
 * Which offer of a Journey map stage is the featured one (docs/LANDING_PAGES.md, "Journey map"): the first marked `featured`,
 * else the first. Pure, shared by the block and the publish checks so both count the same title as the stage's heading.
 * `offers` are the ones the block shows (those with a title, at most four).
 */
export function featuredOfferIndex(offers: readonly { featured?: unknown }[]): number {
  const marked = offers.findIndex((offer) => offer?.featured === true);
  return marked >= 0 ? marked : 0;
}
