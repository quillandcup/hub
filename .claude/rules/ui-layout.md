---
paths:
  - "app/**/*.tsx"
  - "components/**"
  - "config/tailwind.ts"
  - "tests/lib/z-layers.test.ts"
  - "tests/lib/viewport-layouts.test.ts"
---

### Responsive Layout: Viewport for the Shell, Container Queries Inside It

**RULE**: Viewport breakpoints (`sm:`/`md:`/`lg:`/`xl:`) decide the app shell only; a layout *inside the content area* that depends on how much room it has uses container queries: `@container` on a wrapper, and the *named* sizes from `theme.extend.containers` in `config/tailwind.ts` on children (`@pair:`, `@cards:`, `@split:`, `@columns:`, `@outline:`, from the `@tailwindcss/container-queries` plugin; the app is on Tailwind 3.4). Never the plugin's default sizes (`@md:`, `@3xl:`) or `@[62rem]:` literals: `tests/lib/container-sizes.test.ts` fails on them, so every page reflows at the same widths. `tests/lib/viewport-layouts.test.ts` likewise fails on a viewport `sm:`/`md:`/`lg:`/`xl:` `flex-row`, `flex-col`, `flex-wrap`/`flex-nowrap`, `grid-cols-*` or column/row placement in `app` or `components`, unless the file is in its allowlist with a reason (today only `ConsentBanner`, which is `fixed` to the window); visibility, spacing and text variants (`lg:hidden`, `sm:p-6`) are not checked. Write them mobile-first: the plugin has no `@max-*` variants, so the small-screen style is the base and the named size overrides it. A container can't query itself, so the `@container` goes on a wrapper around the element that changes, and never on an ancestor of `fixed` overlays (it contains them).

**Why**: The content area is narrower than the window by the sidebar's width. A page that picks its own viewport breakpoint has to guess what the shell is doing, and the guesses drift: the lesson page moved its outline into a side column at `lg` (1024px) while the sidebar was still visible until `md` (768px), so from 768-1023px the video was squeezed between two panels.

- The member and admin sidebars show from `lg` and become a hamburger menu below it (`components/MemberNavigation.tsx`, `app/(admin)/admin/AdminNavigation.tsx`, `components/MobileMenuButton.tsx`: change all three together). `@outline` is derived from this (the content area jumps 16rem narrower when the sidebar appears, so it is set above any width reachable then); if the sidebar's width or `lg` switch point changes, revisit it in `config/tailwind.ts`. Use Tailwind's default breakpoints; define any new one once in `theme.screens` in `config/tailwind.ts`, not as `min-[...px]` literals.
- Until a page is converted to container queries, a side column next to the main content must start at a viewport breakpoint at which the sidebar is already shown *and* enough room is left (the sidebar is 16rem wide).
- Mobile-first: base styles for small screens, then add `sm:`/`md:`... as it grows. Don't pick a layout in JavaScript (`useMediaQuery`): it flashes and mismatches on hydration.
- Check a layout change at widths just either side of every breakpoint it touches (e.g. 700, 800, 1000, 1100px), not just phone/tablet/desktop; the squeezed zone sits between two breakpoints.

### Stacking Order: Named Layers, Never Numbers

**RULE**: Use a named z-index layer from `theme.extend.zIndex` in `config/tailwind.ts` (`z-raised`, `z-float`, `z-sticky`, `z-dropdown`, `z-shell`, `z-overlay`...), never `z-30` or `z-[55]`: `tests/lib/z-layers.test.ts` fails on a numeric `z-*`. A positioned element with a z-index makes a stacking context, so a popover inside the header ranks as the header; that is why `z-shell` is above `z-sticky` and `z-dropdown`. Which layer is for what, and the portal and `isolate` rules: `docs/Z_LAYERS.md`.
