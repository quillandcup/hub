---
paths:
  - "src/components/**"
  - "src/lib/hooks/**"
  - "src/lib/shortcuts.ts"
  - "src/lib/keyboard.ts"
  - "src/app/**/*.tsx"
---

## keyboard-shortcuts

The `?` panel (`src/components/shortcuts/`) lists the shortcuts from the registry in `src/lib/shortcuts.ts`. The registry only describes: the handlers live in their components, so the tests are what keep the two together.

**A new or changed keyboard shortcut**
- Register it in `src/lib/shortcuts.ts` (a page-scoped group also calls `useRegisterShortcuts("<group>")` in its component), or, for a set owned by one component, export a constant next to it that the registry reads, as `TableKeyboardNav` and `CalendarKeyboardNav` do. Change the entry in the same commit as the handler.
- Show the key with `Kbd` (`src/components/Kbd.tsx`), and declare it with `aria-keyshortcuts` where it sits on a button.
- A single-key or page-wide shortcut stays out of the way while the member types, holds a modifier or has a dialog, menu or open list on screen: use `isTypingTarget`, `hasCommandModifier` and `isOverlayOpen` from `src/lib/keyboard.ts`. Row and list keys come from `TableKeyboardNav` and `useComboboxKeys` (`reuse-ui-components.md`), never a hand-written handler.
- Pin it with a test: a hand-written registry entry needs a driver in `tests/components/ShortcutDrivers.test.tsx` (renders the real component, presses the registered keys, asserts the handler responds; a missing driver or a changed key fails). Table and calendar entries are already tied to their constants in `tests/lib/shortcuts.test.ts`.

**Guards**
- `tests/lib/shortcuts.test.ts`: unique ids and keys, no clash with the basics, page-scoped groups name the components (or shared hook) that register them (`components` in `SHORTCUT_GROUPS`: the pickers and `Modal` report "Pickers" and "Forms in dialogs"), table and calendar read from their own constants.
- `tests/components/ShortcutDrivers.test.tsx`: the behavior of each hand-written entry.
- `tests/lib/shortcut-listeners.test.ts`: a `document`/`window` `keydown` listener that reads any key besides Escape fails unless its file is on the short allowlist there, with a reason. Register the shortcut rather than adding to the list; the list is for things that are not shortcuts or are known gaps noted in `docs/TODO.md`.

What these do not catch: a handler that reads keys through an element `onKeyDown` (only the page-wide listeners are scanned), and a shortcut registered with the right keys but the wrong label. The registry-driven design that would remove the drift is in `docs/TODO.md`, "Registry-driven keyboard handlers".
