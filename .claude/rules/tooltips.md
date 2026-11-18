---
paths:
  - "app/**/*.tsx"
  - "components/**"
  - "tests/lib/tooltips.test.ts"
  - "tests/lib/tooltip-native-title.test.ts"
---

## tooltips

**RULE**: A hint on a control (an icon button, a toggle, a link, a disabled action that says why) is `<Tooltip content="...">` from `components/Tooltip.tsx`, wrapped around that one control. Not a native `title="..."` (a small grey browser box that looks different from every other tooltip, never shows on a touch screen, can't be styled and is not reliably read by screen readers), and not a hand-rolled hover box. `tests/lib/tooltip-native-title.test.ts` fails on a native `title` on a DOM element in `app` or `components` that is not in its baseline; `tests/lib/tooltips.test.ts` fails on a hand-rolled hidden box and on `role="tooltip"` outside `Tooltip` and `InfoTip`. `<iframe title>` (it names the frame), `<svg><title>`, a page `<title>` and a component's own `title` prop (a modal's heading) are not tooltips and are fine.

- **One look**: dark rounded box, white text (`dark:bg-slate-700` in dark mode), drawn on `<body>` at `z-overlay-top` so no scrolling card or modal clips it. Never build another.
- **What it guarantees** (don't undo it): hover only on a device that hovers (the `(hover: hover)` query, checked when the pointer arrives) never from a touch tap or iOS sticky hover (a finger or pen shows it only on a long press of about 500ms without moving more than 8px; that press swallows the click and context menu that follow, so long-pressing a star doesn't toggle it, and the control gets `select-none` and no touch callout where there is no hover; moving, scrolling, lifting early or a cancelled pointer cancel it, a drag taking it down; it stays about 2.5s, or goes on a touch elsewhere); keyboard `:focus-visible` shows it, a click or tap focus doesn't; a short delay before it shows on hover; Escape hides it; it stays up while the pointer is over the tip (WCAG 1.4.13); it is linked to the control with `aria-describedby` while shown; it adds no wrapper element, so the layout around the control doesn't change; its position is kept inside the window and flips above near the bottom edge.
- **`touchContent`** is the text for the long press when it should differ (keyboard instructions mean nothing on a phone: the drag handle says "Drag to reorder" on touch and the full keyboard text on hover and focus).
- **Never the only place essential information lives.** The control keeps its own name (`aria-label` or visible text); the tooltip adds detail (what a toggle does, why an action is off). A touch user only sees it after a long press they may never try, so anything they need to act goes on the page. A tooltip that says why a control is off works on a `disabled` button in Chromium (checked); Safari and Firefox are less consistent about pointer events on `disabled` controls, so where the reason matters, also show it on the page, or use `aria-disabled="true"` and ignore the click.
- **Only on something focusable** (a button, a link, an input), so keyboard users can reach it. A hint on a bare `span` or `div` is not reachable: put it on the control, make the element a button, or show the text on the page.
- **The child must accept the handlers**: a DOM element does; a component must pass `onPointerEnter`, `onPointerLeave`, `onPointerDown`, `onFocus`, `onBlur` and `aria-describedby` on to its element.
- **`content` can be `undefined`** (the tooltip then does nothing), so a conditional hint is `content={reason ?? undefined}`.
- **`InfoTip` is for a definition**: an (i) icon whose text can be long or hold a link. It is the same dark box.
- **Existing files** that still use a native `title` are in the baseline of `tests/lib/tooltip-native-title.test.ts`. Convert them as you touch them and lower the entry; the test fails on a stale entry and on a file with more titles than listed, so the list only shrinks. The deferred work is `docs/TODO.md`, "Move the Remaining Native title Tooltips onto Tooltip".
