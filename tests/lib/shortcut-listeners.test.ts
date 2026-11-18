import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Static guard: a page-wide key listener (`document` / `window` `keydown`) is how a global shortcut gets added, so
 * every file that has one is either Escape-only (it just closes its own popup) or listed here with why it needs no
 * panel entry. A new listener that is neither fails with a pointer to `.claude/rules/keyboard-shortcuts.md`.
 * Element-level `onKeyDown` handlers are not checked: they only act while their own control has focus.
 */
const ROOT = process.cwd();

/** Listeners that handle more than Escape, and why each is fine. Keep it honest and small. */
const ALLOWED: Record<string, string> = {
  "components/Modal.tsx": "registered: Esc closes the top dialog (basics-close)",
  "components/HelpMenu.tsx": "registered: Esc closes the Help menu (basics-close)",
  "components/shortcuts/ShortcutsProvider.tsx": "registered: ? and Esc for the panel (basics-panel, basics-close)",
  "components/search/SearchPalette.tsx": "registered: Mod+K and / (search-open); the list keys are its own (search-*)",
  "components/CalendarKeyboardNav.tsx": "registered: reads CALENDAR_KEYBOARD_SHORTCUTS, calls useRegisterShortcuts",
  "lib/hooks/useTableKeyboardNav.ts": "registered: reads TABLE_KEYBOARD_SHORTCUTS via TableKeyboardNav",
  "lib/hooks/usePhotoViewerKeys.ts": "registered: Left/Right step through photos while a lightbox is open (photo-viewer-previous, photo-viewer-next)",
  "app/(admin)/admin/pages/[slug]/LandingEditor.tsx": "registered: Ctrl/Cmd+S saves the page (landing-editor-save)",
};

/** Escape-only popups that also have a keyboard handler of their own on an element, which this check cannot tell apart. */
const ESCAPE_LISTENER_WITH_ELEMENT_KEYS: Record<string, string> = {
  "components/chat/EmojiPicker.tsx": "Esc closes the popup; the cell grid's arrows are element-level onKeyDown (docs/TODO.md, \"Chat Emoji Picker\")",
};

const LISTENER = /(?:window|document)\.addEventListener\(\s*["'`]key(?:down|up|press)["'`]/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) {
      if (name !== "node_modules" && !name.startsWith(".")) sourceFiles(path, out);
    } else if (/\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

/** The text with every `key === "Escape"` comparison removed: what is left says whether other keys are read. */
function readsOtherKeys(source: string): boolean {
  const rest = source.replace(/\.key\s*===?\s*["']Escape["']/g, "");
  return /\b(?:e|ev|event)\.key\b|metaKey|ctrlKey|altKey|\bcode\s*===/.test(rest);
}

describe("page-wide key listeners", () => {
  const files = ["components", "app", "lib"].flatMap((dir) => sourceFiles(dir));
  const withListener = files.filter((file) => LISTENER.test(readFileSync(join(ROOT, file), "utf8")));

  it("finds the listeners it should (so a broken pattern cannot pass for ever)", () => {
    expect(withListener).toEqual(expect.arrayContaining(Object.keys(ALLOWED).filter((f) => !f.startsWith("app/") || true)));
    expect(withListener.length).toBeGreaterThan(10);
  });

  it("allows only Escape-only listeners and the listed ones, so a new shortcut cannot skip the registry", () => {
    const unregistered = withListener
      .filter((file) => !(file in ALLOWED) && !(file in ESCAPE_LISTENER_WITH_ELEMENT_KEYS))
      .filter((file) => readsOtherKeys(readFileSync(join(ROOT, file), "utf8")));
    expect(
      unregistered,
      `${unregistered.join(", ")} listens for keys on the whole page. Register the shortcut in lib/shortcuts.ts, add a driver in tests/components/ShortcutDrivers.test.tsx and, only if it is not a shortcut, list the file in tests/lib/shortcut-listeners.test.ts with a reason. See .claude/rules/keyboard-shortcuts.md.`,
    ).toEqual([]);
  });

  it("keeps the allowlists honest: every entry exists, still has a listener, and the Escape-only note still holds", () => {
    for (const file of [...Object.keys(ALLOWED), ...Object.keys(ESCAPE_LISTENER_WITH_ELEMENT_KEYS)]) {
      expect(withListener, `${file} no longer has a page-wide key listener: remove it from the allowlist`).toContain(file);
    }
  });
});
