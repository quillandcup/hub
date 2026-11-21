# Page blocks: the registry, and modules that contribute to it

> **Status:** living. **Last reviewed:** 2026-11-21. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

The page builder ([Landing pages](../product/LANDING_PAGES.md)) offers blocks. A block about events (the next retreats, today's schedule) needs events code, but the page builder must not: it is meant to be reused without the events part, and the next product (a real estate app, a community product) will bring blocks of its own. So the builder has one **block registry**, and a **module** (`src/modules/<name>/`) adds blocks to it. The pages code never imports a module; the one place that names which modules are installed is the **composition root**, `src/modules/`.

This is the first and so far only contribution point (page blocks). It is deliberately concrete: no plugin framework, no discovery, no loading at run time. A general shape for modules is for a later decision, written from what this teaches.

## The pieces

| Piece | Where | Side |
|---|---|---|
| `PageBlockDefinition`, `definePageBlock`, `createPageBlockRegistry` | `src/components/landing/block-registry.ts` | both (plain data and functions) |
| The pages code's own blocks (`coreBlocks`) | `src/components/landing/core-blocks.ts` | both |
| The installed registry (`pageBlocks`), the render config, the tables other code reads (`BLOCK_DEFAULTS`, `SLOTS`, `SLOT_ALLOW`, `ITEM_BLOCKS`) | `src/components/landing/config.tsx` | both |
| Editor kit (`createEditorKit`) and the editor config | `src/components/landing/editor-kit.tsx`, `editor-config.tsx` | client only |
| Live data plumbing (`PageDataLoader`, `resolveLiveBlocks`) and the server entry (`withLiveData`) | `src/lib/landing/live-data.ts`, `live-server.ts` | server only |
| Composition root | `src/modules/index.ts` (blocks), `editor.ts` (fields), `server.ts` (data loaders) | one file per side |
| The events module's contribution | `src/modules/events/page-blocks/` (`index.ts`, `blocks.tsx`, `editor.tsx`, `server.ts`, `live-*.ts`) | one file per side |

A contribution has up to three parts, because the three sides must not load each other's code: the **blocks** (a `PageBlockContribution`: definitions with components, safe for the server and the browser, so the public page ships no editor), the **editor fields** (a `PageBlockEditorContribution`, client only: the fields carry TipTap and the media picker) and the **data loaders** (`PageDataLoader`, server only: they read the database). The composition root lists each side's contributions in its own file.

## A block definition

`definePageBlock({ type, label, category, order, defaults, render, slots?, itemLimit?, itemRule?, publishCheck? })`:

- `type` is the name stored in page JSON. **Never rename one**; stored pages (draft, published, every version) carry it, and a module installed later must keep the names its blocks were stored under.
- `category` is a palette group (`layout`, `ready_made`, `homepage`, `content`, `links`, or `parts` for an item that lives inside another block's list) and `order` its position there (lower first; leave gaps so a module's block can sit between two others).
- `slots` names the lists of child blocks the block holds, and `allow` what a slot takes (the items of a list: `{ items: { allow: ["Step"] } }`). `itemLimit` is how many items the layout is made for; `itemRule` says how the publish check names them; `publishCheck(props, tools)` adds checks (a heading the block draws, a button with no link).
- Everything else the app reads about blocks (palette groups, defaults, labels, what each slot takes, the parts list, limits) is **derived** from the definitions, so there is one place to say a thing.

`createPageBlockRegistry(contributions)` builds the registry and throws, naming both owners, when two blocks share a type, and for an unusable definition (no label or component, a slot that takes an unregistered type, a "part" no slot takes). A wrong contribution fails at startup and in `tests/lib/page-block-registry.test.ts`, not as a block that quietly goes missing.

## What a module that is not installed means

Stored JSON is unchanged by any of this. If a page holds a block no installed module registers:

- **Visitors and the preview**: the block draws nothing, and the rest of the page renders (`LandingRender`).
- **The editor**: the page opens; the block shows a quiet note ("not available here, kept as it is") and its props are left exactly as stored, so saving loses nothing (`block-placeholder.tsx`, applied by `editorConfigFor`). It is not in the palette.
- **The JSON import** accepts only registered types, so a block of a missing module in an imported file is dropped. The AI builder offers a fixed list of the pages code's blocks (`AI_BLOCKS`), none of them a module's.

## Live data

A block that shows live values (the schedule, the next events, the figures) gets them in a render-only `live` prop. A `PageDataLoader` is `{ id, types, load(page, now) }`: `types` are the block types it serves (a stored `live` prop on them is always dropped first), and `load` reads what the page needs once, in parallel with the other loaders, and returns a function that gives each block its `live` props (or null when there is nothing to do). A loader that throws is logged by code and its blocks keep their typed values. Loaders cache through `src/lib/landing/live-cache.ts` (one minute, one tag). The pages code's own loader (the Outcome numbers' figures, `live-stats-loader.ts`) uses the same contract.

## The boundary

`config/eslint.mjs` has two rules, and `tests/lib/page-block-boundary.test.ts` checks them against sample imports and against the real files:

1. The pages code (`src/lib/landing`, `src/components/landing`) does not import events code (`lib/events-*`, `lib/event-*`, `lib/calendar-*`, `lib/data/events`, `EventArt`, the events pages) or a module's internals.
2. Nothing outside `src/modules/` names a module's internals either. Only the three root files do: everyone else imports `@/modules`, `@/modules/editor` or `@/modules/server`, which are lists.

The dependency runs one way: a module may import the pages code (`@/components/landing/...`, `@/lib/landing/...`), never the reverse. `src/modules` is in the knip, coverage and Tailwind content globs like the other source folders.

## Adding a block

- **To the pages code**: see "Adding a block" in [Landing pages](../product/LANDING_PAGES.md) (a component, defaults and a `core(...)` entry, fields).
- **To a module** (or a new module):
  1. In `src/modules/<name>/page-blocks/`: the components, an `index.ts` exporting a `PageBlockContribution` (`{ id, blocks: [definePageBlock(...)] }`), an `editor.tsx` exporting a `PageBlockEditorContribution` (`fields: (kit) => ({ BlockType: { ... } })`, using the kit's `text`, `select`, `image`, `itemsSlot`, ...), and, for live values, a `server.ts` exporting `PageDataLoader`s.
  2. Add the three to `src/modules/index.ts`, `editor.ts` and `server.ts`. That is the whole installation; removing the lines is the whole uninstall.
  3. Tests: the block (render and fields), the loader, and that the page still renders without the module (`tests/components/page-block-composition.test.tsx` builds the registry with and without the events module).

## Not done yet

What is deferred (the Outcome numbers and other live figures are Hub community data that probably belong in a module of their own; a module's own migrations, routes and nav entries are not contribution points yet) is in `docs/TODO.md`, "Page block registry: next steps".
