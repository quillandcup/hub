import type { PageBlockContribution } from "@/components/landing/block-registry";
import { eventsPageBlocks, type EVENT_BLOCK_DEFAULTS } from "./events/page-blocks";

/**
 * The composition root: the one place that names which modules are installed. Each module contributes to the host's contribution points
 * with static imports (no discovery, no loading at run time), and the host builds its registries from these lists:
 *
 * - `index.ts` (this file), the render side of the page blocks: safe to import from the server and the browser. Built into the
 *   registry the editor's config and the public renderer both read (`src/components/landing/config.tsx`).
 * - `editor.ts`, the editor fields of those blocks: client only.
 * - `server.ts`, their live data loaders: server only.
 *
 * Nothing under `src/lib/landing` or `src/components/landing` may import a module directly (`config/eslint.mjs`); they import this root.
 * To leave a module out, remove its line from all three files: the pages still render, and a stored block the module owned shows as a
 * placeholder in the editor and draws nothing for visitors. See docs/architecture/PAGE_BLOCKS.md.
 */
export const installedPageBlocks: readonly PageBlockContribution[] = [eventsPageBlocks];

/** The default props of the installed modules' blocks, for the pages code's typed `BLOCK_DEFAULTS`. */
export type InstalledBlockDefaults = typeof EVENT_BLOCK_DEFAULTS;
