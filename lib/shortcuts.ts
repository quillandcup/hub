import { CALENDAR_KEYBOARD_SHORTCUTS } from "@/components/CalendarKeyboardNav";
import { TABLE_KEYBOARD_SHORTCUTS } from "@/components/TableKeyboardNav";

/**
 * The registry behind the keyboard shortcuts panel (`components/shortcuts/ShortcutsPanel.tsx`, opened with `?`).
 * It only DESCRIBES: every handler stays in its own component, so an entry here must match that handler.
 * `tests/lib/shortcuts.test.ts` keeps it honest: no two shortcuts in a group claim the same keys, and every
 * page-scoped group names the components that really report themselves (`useRegisterShortcuts`).
 *
 * To add a shortcut: put the entry in `SHORTCUTS` (or, for a page-scoped group, in the constant next to its component
 * and map it below). To add a page-scoped group: add it to `SHORTCUT_GROUPS` with its `components`, and call
 * `useRegisterShortcuts("<group>")` in each of them, so the panel lists it only while it is on the page.
 *
 * Keys are `Kbd` names (`components/Kbd.tsx`). A chord is pressed together (`["shift", "j"]`); a list of chords
 * are alternatives for the same action (`[["j"], ["down"]]`, shown with "or").
 */

export type ShortcutGroupId = "basics" | "search" | "pickers" | "forms" | "chat" | "table" | "calendar" | "landingEditor" | "photoViewer";

/** `global`: works wherever the app shell is. `page-key`: only while its component is on the page. */
export type ShortcutScope = "global" | "page-key";

/** What a table must be able to do for the shortcut to apply (see `TABLE_KEYBOARD_SHORTCUTS`). */
export type ShortcutNeed = "open" | "select" | "paging";

export interface ShortcutGroup {
  /** The heading in the panel. */
  section: string;
  scope: ShortcutScope;
  /**
   * For a `page-key` group: the files that call `useRegisterShortcuts` with this group's id (the component, or the shared
   * hook or the several components that all report the same keys, like the two pickers).
   */
  components?: string[];
}

/** In the order the panel lists them (page-scoped ones are lifted to the top while mounted). */
export const SHORTCUT_GROUPS: Record<ShortcutGroupId, ShortcutGroup> = {
  basics: { section: "Basics", scope: "global" },
  search: { section: "Search", scope: "global" },
  table: { section: "Lists and tables", scope: "page-key", components: ["components/TableKeyboardNav.tsx"] },
  calendar: { section: "Calendar", scope: "page-key", components: ["components/CalendarKeyboardNav.tsx"] },
  chat: { section: "Chat", scope: "page-key", components: ["components/chat/Composer.tsx"] },
  landingEditor: { section: "Page editor", scope: "page-key", components: ["app/(admin)/admin/pages/[slug]/LandingEditor.tsx"] },
  photoViewer: { section: "Photo viewer", scope: "page-key", components: ["lib/hooks/usePhotoViewerKeys.ts"] },
  pickers: { section: "Pickers", scope: "page-key", components: ["components/EntitySearch.tsx", "components/MultiEntitySearch.tsx"] },
  forms: { section: "Forms in dialogs", scope: "page-key", components: ["components/Modal.tsx"] },
};

export interface Shortcut {
  id: string;
  section: string;
  group: ShortcutGroupId;
  scope: ShortcutScope;
  keys: string[][];
  label: string;
  needs?: ShortcutNeed;
}

type Entry = Omit<Shortcut, "section" | "scope">;

/** The table's constant lists one entry per chord; the panel shows the chords of one action together. */
function tableEntries(): Entry[] {
  const merged: Entry[] = [];
  for (const { keys, label, needs } of TABLE_KEYBOARD_SHORTCUTS) {
    const same = merged.find((entry) => entry.label === label && entry.needs === needs);
    if (same) same.keys.push(keys);
    else merged.push({ id: `table-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`, group: "table", keys: [keys], label, needs });
  }
  return merged;
}

const ENTRIES: Entry[] = [
  // Handled in `components/shortcuts/ShortcutsProvider.tsx`, `Modal.tsx` and `HelpMenu.tsx`.
  { id: "basics-panel", group: "basics", keys: [["?"]], label: "Show or hide keyboard shortcuts" },
  { id: "basics-close", group: "basics", keys: [["esc"]], label: "Close a dialog, a menu, a picker's list or this panel" },
  // `components/search/SearchPalette.tsx`.
  { id: "search-open", group: "search", keys: [["mod", "K"], ["/"]], label: "Open search" },
  { id: "search-move", group: "search", keys: [["up"], ["down"]], label: "Move through the results" },
  { id: "search-go", group: "search", keys: [["enter"]], label: "Open the highlighted result" },
  { id: "search-close", group: "search", keys: [["esc"]], label: "Close search" },
  // `lib/submit-form-on-mod-enter.ts`, reported by `Modal` while a dialog with a form is open.
  { id: "forms-submit", group: "forms", keys: [["mod", "enter"]], label: "Save a form in a dialog" },
  // `lib/hooks/useComboboxKeys.ts`, reported by `EntitySearch` and `MultiEntitySearch` while one is on the page.
  { id: "pickers-move", group: "pickers", keys: [["up"], ["down"]], label: "Move through a picker's options" },
  { id: "pickers-pick", group: "pickers", keys: [["enter"]], label: "Choose the highlighted option" },
  { id: "pickers-remove", group: "pickers", keys: [["Backspace"]], label: "Remove the last chosen item (empty search box)" },
  // `components/chat/Composer.tsx`.
  { id: "chat-send", group: "chat", keys: [["enter"]], label: "Send the message" },
  { id: "chat-newline", group: "chat", keys: [["shift", "enter"]], label: "Start a new line" },
  // `app/(admin)/admin/pages/[slug]/LandingEditor.tsx`: admin only, while a landing page is open in the editor.
  { id: "landing-editor-save", group: "landingEditor", keys: [["mod", "S"]], label: "Save the page now (it also saves by itself)" },
  // `lib/hooks/usePhotoViewerKeys.ts`, used by `ImageLightbox.tsx` and `PhotoLightbox.tsx`: only while a photo is open full size.
  { id: "photo-viewer-previous", group: "photoViewer", keys: [["left"]], label: "Previous photo" },
  { id: "photo-viewer-next", group: "photoViewer", keys: [["right"]], label: "Next photo" },
  ...tableEntries(),
  ...CALENDAR_KEYBOARD_SHORTCUTS.map(({ keys, label }) => ({
    id: `calendar-${label.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    group: "calendar" as const,
    keys,
    label,
  })),
];

export const SHORTCUTS: readonly Shortcut[] = ENTRIES.map((entry) => ({
  ...entry,
  section: SHORTCUT_GROUPS[entry.group].section,
  scope: SHORTCUT_GROUPS[entry.group].scope,
}));

/** What one mounted component reports: its group, and the optional abilities it has (a table that can open rows). */
export interface ShortcutRegistration {
  group: ShortcutGroupId;
  has: readonly ShortcutNeed[];
}

export interface ShortcutSection {
  group: ShortcutGroupId;
  section: string;
  scope: ShortcutScope;
  shortcuts: Shortcut[];
}

/** One chord as text for matching a search ("shift j", "mod", "ctrl", "cmd", "↑"). */
function chordWords(chord: string[]): string {
  const words = chord.flatMap((key) => {
    const lower = key.toLowerCase();
    if (lower === "mod") return ["mod", "ctrl", "control", "cmd", "command", "⌘"];
    if (lower === "enter") return ["enter", "return", "↵"];
    if (lower === "esc") return ["esc", "escape"];
    if (lower === "up") return ["up", "↑", "arrow"];
    if (lower === "down") return ["down", "↓", "arrow"];
    if (lower === "left") return ["left", "←", "arrow"];
    if (lower === "right") return ["right", "→", "arrow"];
    return [lower];
  });
  return words.join(" ");
}

/** Whether a shortcut answers a search: every word must appear in its label, section or keys. */
export function matchesShortcut(shortcut: Shortcut, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = [shortcut.label, shortcut.section, ...shortcut.keys.map(chordWords)].join(" ").toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/**
 * What the panel shows: the page-scoped groups that are mounted first (a shortcut that `needs` an ability only if some
 * mounted component has it), then the global ones, each section in `SHORTCUT_GROUPS` order, filtered by the search.
 */
export function visibleSections(registrations: readonly ShortcutRegistration[], query = ""): ShortcutSection[] {
  const sections: ShortcutSection[] = [];
  for (const group of Object.keys(SHORTCUT_GROUPS) as ShortcutGroupId[]) {
    const { section, scope } = SHORTCUT_GROUPS[group];
    const mounted = registrations.filter((registration) => registration.group === group);
    if (scope === "page-key" && mounted.length === 0) continue;
    const shortcuts = SHORTCUTS.filter(
      (shortcut) =>
        shortcut.group === group &&
        (!shortcut.needs || mounted.some((registration) => registration.has.includes(shortcut.needs!))) &&
        matchesShortcut(shortcut, query),
    );
    if (shortcuts.length > 0) sections.push({ group, section, scope, shortcuts });
  }
  // Stable: the page's own sections first, the everywhere ones after.
  return [...sections.filter((s) => s.scope === "page-key"), ...sections.filter((s) => s.scope === "global")];
}
