import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Viewport breakpoints (`sm:`/`md:`/`lg:`/`xl:`/`2xl:`) decide the app shell only; a layout inside the
 * content area follows the room it has, with a container query (`@container` + `@pair:`, `@split:`...;
 * "Responsive Layout" in CLAUDE.md). This fails on the structural viewport variants (stacking, columns and
 * their placement) in app and components, so a page can't guess what the shell is doing. Visibility,
 * spacing and text variants (`lg:hidden`, `sm:p-6`) are not covered: the shell legitimately uses them.
 *
 * Allowlist: files whose layout really is the window's, with the reason. A stale entry (no longer
 * matching) fails too, so the list can't rot.
 */
const ALLOWED: Record<string, string> = {
  "components/ConsentBanner.tsx": "fixed to the bottom of the window, outside the app shell: laid out by the viewport",
};

const STRUCTURAL = /(?<![\w@-])((?:sm|md|lg|xl|2xl):(?:flex-row|flex-col|flex-row-reverse|flex-col-reverse|grid-cols-[\w[\](),.%_-]+|col-span-\w+|col-start-\w+|col-end-\w+|row-span-\w+|row-start-\w+))/g;

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

/** Repo-relative file -> the viewport layout variants it uses. */
function viewportLayouts(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of ["app", "components"].flatMap((dir) => sourceFiles(path.join(root, dir)))) {
    const matches = [...fs.readFileSync(file, "utf8").matchAll(STRUCTURAL)].map((m) => m[1]);
    if (matches.length) found.set(path.relative(root, file), matches);
  }
  return found;
}

describe("viewport layouts", () => {
  it("are only used where the layout really is the window's (the allowlist)", () => {
    const offenders = [...viewportLayouts()].filter(([file]) => !(file in ALLOWED)).map(([file, variants]) => `${file}: ${[...new Set(variants)].join(" ")}`);

    expect(offenders).toEqual([]);
  });

  it("has no stale allowlist entries", () => {
    const used = viewportLayouts();

    expect(Object.keys(ALLOWED).filter((file) => !used.has(file))).toEqual([]);
  });
});
