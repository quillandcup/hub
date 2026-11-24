# Stacking layers (z-index)

> **Status:** living. **Last reviewed:** 2026-11-20. Review: yearly. Kept up to date with the code; if it is wrong, fix it.

Lists the named z-index layers that every stacked element must use, and the stacking rules around them. Never write a number (`z-30`, `z-[55]`). Use a named layer from `config/tailwind.ts` (`theme.extend.zIndex`); `tests/lib/z-layers.test.ts` fails on a numeric `z-*`.

| Layer | Use |
|---|---|
| `z-raised` | lifts one thing over its siblings inside a component (a card's click area, a resize handle) |
| `z-float` | floats over content: the "new messages" pill, a side panel over the chat |
| `z-sticky` | sticky bars that cover what scrolls under them (chat day divider, calendar week header) |
| `z-dropdown` | popups anchored to a control: menus, tooltips, autocomplete, pickers, and a message's hover toolbar (it must cover the sticky day divider, and its tooltips and emoji picker rank with it) |
| `z-rail` / `z-rail-open` | desktop sidebar rail: closed under the app header, open over it |
| `z-shell` | the app header, announcement bars, fixed corner widgets |
| `z-overlay` | modals, lightboxes, mobile drawers and their backdrops, banners |
| `z-overlay-top` | above any modal: the search palette, the tour's spotlight, and `Tooltip` (drawn on `<body>`, so it clears a modal and the palette) |

Rules:
- A positioned element with a z-index (and `sticky`, `fixed`, `transform`, `filter`, `isolate`) makes a **stacking context**: everything inside ranks as one unit against its siblings. A popover inside the header (`z-shell`) is ranked as the header, whatever its own layer; that is why the header must be above the content's `z-sticky` and `z-dropdown`.
- A component with z-indexes of its own inside should be `isolate`, so they cannot leak out.
- A popup that must show over a modal is rendered through a portal to `<body>`, then takes `z-overlay`.
- Need a new layer? Add it to the scale in `config/tailwind.ts` (and this table), not a one-off number.

**Pairs that overlap.** `tests/lib/z-layer-pairs.test.ts` lists things that meet on screen and which must win (the hover toolbar over the day divider, the header over the page's dropdowns, a modal over the header, the search palette over a modal...). It reads each side's layer from the component's real class. When two things overlap wrongly in the browser, fix the layer and add the pair there.

**Pickers inside a modal.** `EntitySearch`'s and `MultiEntitySearch`'s result lists are drawn (placing is `useBelow`, `src/lib/hooks/useBelow.ts`) on `<body>` (`createPortal`, `fixed`, placed under the input and following it on scroll) at `z-overlay`, because a modal's `overflow-hidden` cut an in-place list off at the dialog's edge. Code that closes on an outside click must treat `[data-entity-search-list]` as inside (see `NewMessagePicker`). The other in-place lists still clip in a modal (`docs/TODO.md`, "Portal the remaining pickers' lists").
