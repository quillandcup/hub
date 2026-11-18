import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CALENDAR_KEYBOARD_SHORTCUTS } from "@/components/CalendarKeyboardNav";
import { TABLE_KEYBOARD_SHORTCUTS } from "@/components/TableKeyboardNav";
import { SHORTCUTS, SHORTCUT_GROUPS, matchesShortcut, visibleSections, type ShortcutGroupId } from "@/lib/shortcuts";

const chord = (keys: string[]) => keys.map((key) => key.toLowerCase()).join("+");

describe("the shortcut registry", () => {
  it("has unique ids, labels and keys on every entry", () => {
    expect(new Set(SHORTCUTS.map((s) => s.id)).size).toBe(SHORTCUTS.length);
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.label.length, shortcut.id).toBeGreaterThan(0);
      expect(shortcut.keys.length, shortcut.id).toBeGreaterThan(0);
      for (const keys of shortcut.keys) expect(keys.length, shortcut.id).toBeGreaterThan(0);
    }
  });

  it("lets no two shortcuts of a group claim the same keys", () => {
    const seen = new Map<string, string>();
    for (const shortcut of SHORTCUTS) {
      for (const keys of shortcut.keys) {
        const claim = `${shortcut.group}:${chord(keys)}`;
        expect(seen.get(claim), `${shortcut.id} and ${seen.get(claim)} both claim ${claim}`).toBeUndefined();
        seen.set(claim, shortcut.id);
      }
    }
  });

  it("lets no page-scoped shortcut claim a key that the basics own", () => {
    const basics = new Set(SHORTCUTS.filter((s) => s.group === "basics").flatMap((s) => s.keys.map(chord)));
    for (const shortcut of SHORTCUTS.filter((s) => s.scope === "page-key")) {
      for (const keys of shortcut.keys) expect(basics.has(chord(keys)), `${shortcut.id}: ${chord(keys)}`).toBe(false);
    }
  });

  it("names, for every page-scoped group, a component that exists and reports itself under that group", () => {
    const pageGroups = (Object.keys(SHORTCUT_GROUPS) as ShortcutGroupId[]).filter((id) => SHORTCUT_GROUPS[id].scope === "page-key");
    expect(pageGroups.length).toBeGreaterThan(0);
    for (const id of pageGroups) {
      const components = SHORTCUT_GROUPS[id].components;
      expect(components?.length, `${id} has no component`).toBeGreaterThan(0);
      for (const component of components!) {
        const source = readFileSync(join(process.cwd(), component), "utf8");
        expect(source, `${component} must call useRegisterShortcuts("${id}")`).toMatch(new RegExp(`useRegisterShortcuts\\(\\s*"${id}"`));
      }
    }
  });

  it("scopes the picker and dialog form keys to the page, leaving only the basics and search everywhere", () => {
    expect(SHORTCUT_GROUPS.pickers.scope).toBe("page-key");
    expect(SHORTCUT_GROUPS.forms.scope).toBe("page-key");
    expect(SHORTCUT_GROUPS.basics.scope).toBe("global");
    expect(SHORTCUT_GROUPS.search.scope).toBe("global");
    const everywhere = visibleSections([]).map((s) => s.group);
    expect(everywhere).toEqual(["basics", "search"]);
    expect(visibleSections([{ group: "pickers", has: [] }]).map((s) => s.group)).toEqual(["pickers", "basics", "search"]);
    expect(visibleSections([{ group: "forms", has: [] }]).flatMap((s) => (s.group === "forms" ? s.shortcuts.map((x) => x.id) : []))).toEqual(["forms-submit"]);
  });

  it("gives global groups no component, and every group at least one shortcut", () => {
    for (const id of Object.keys(SHORTCUT_GROUPS) as ShortcutGroupId[]) {
      if (SHORTCUT_GROUPS[id].scope === "global") expect(SHORTCUT_GROUPS[id].components).toBeUndefined();
      expect(SHORTCUTS.some((s) => s.group === id), id).toBe(true);
    }
  });

  it("reads the table keys from the table's own constant, every chord of it", () => {
    const registered = SHORTCUTS.filter((s) => s.group === "table");
    const chords = registered.flatMap((s) => s.keys.map(chord)).sort();
    expect(chords).toEqual(TABLE_KEYBOARD_SHORTCUTS.map((s) => chord(s.keys)).sort());
    for (const entry of TABLE_KEYBOARD_SHORTCUTS) {
      expect(registered.find((s) => s.label === entry.label)?.needs).toBe(entry.needs);
    }
  });

  it("reads the calendar keys from the calendar's own constant", () => {
    const registered = SHORTCUTS.filter((s) => s.group === "calendar");
    expect(registered.map((s) => [s.label, s.keys])).toEqual(CALENDAR_KEYBOARD_SHORTCUTS.map((s) => [s.label, s.keys]));
  });

  it("only puts the optional table keys where the table can do them", () => {
    const keysOf = (has: Array<"open" | "select" | "paging">) =>
      visibleSections([{ group: "table", has }]).flatMap((s) => s.shortcuts.map((x) => x.label));
    expect(keysOf([])).not.toContain("Open the row");
    expect(keysOf(["open"])).toContain("Open the row");
    expect(keysOf(["paging"])).toContain("Next page");
    expect(keysOf([])).toContain("Next row");
  });

  it("lists mounted page sections before the global ones", () => {
    const order = visibleSections([{ group: "calendar", has: [] }, { group: "table", has: [] }]).map((s) => s.group);
    expect(order.slice(0, 2)).toEqual(["table", "calendar"]);
    expect(order).toContain("basics");
    expect(visibleSections([]).some((s) => s.scope === "page-key")).toBe(false);
  });

  it("matches a search on label, section and keys, every word", () => {
    const next = SHORTCUTS.find((s) => s.id === "calendar-next-week")!;
    expect(matchesShortcut(next, "")).toBe(true);
    expect(matchesShortcut(next, "next")).toBe(true);
    expect(matchesShortcut(next, "calendar j")).toBe(true);
    expect(matchesShortcut(next, "week zz")).toBe(false);
    const save = SHORTCUTS.find((s) => s.id === "forms-submit")!;
    expect(matchesShortcut(save, "command return")).toBe(true);
    expect(matchesShortcut(save, "ctrl")).toBe(true);
  });
});
