import { definePageBlock, type PageBlockContribution } from "@/components/landing/block-registry";
import { HedgieBookshelf } from "./blocks";
import { BOOKSHELF_DEFAULT_FIRST_SHOWN, BOOKSHELF_DEFAULT_MAX } from "./live-books";

/**
 * The Bookshelf module's contribution to the page builder (the render side, safe for the server and the browser): the Hedgie
 * Bookshelf block, the books members keep at the globe. Its editor fields are `editor.tsx`, its live data loader `server.ts`; the
 * composition root (`src/modules/`) lists all three. Without this module installed, a stored page that uses the block still renders
 * (it draws nothing) and still opens in the editor (a placeholder stands in for it). `type` is never renamed.
 */

export const BOOKSHELF_BLOCK_DEFAULTS = {
  HedgieBookshelf: { heading: "The Hedgie Bookshelf", intro: "Books written by our members.", genre: "", max: BOOKSHELF_DEFAULT_MAX, firstShown: BOOKSHELF_DEFAULT_FIRST_SHOWN, emptyText: "", padding: "medium" },
} as const;

export const bookshelfPageBlocks: PageBlockContribution = {
  id: "bookshelf",
  blocks: [
    definePageBlock({
      type: "HedgieBookshelf",
      label: "Hedgie Bookshelf",
      category: "homepage",
      order: 130,
      defaults: BOOKSHELF_BLOCK_DEFAULTS.HedgieBookshelf,
      render: HedgieBookshelf,
      publishCheck: (p, { str, heading }) => {
        // The same heading the block draws.
        if (str(p.heading)) heading(3, str(p.heading));
      },
    }),
  ],
};
