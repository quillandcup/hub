import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tooltips and popovers go through `InfoTip` (components/InfoTip.tsx), which hides with display:none and
 * stays inside the viewport on a phone. A hand-rolled hover box hidden with `opacity-0`/`invisible` is
 * still laid out: a 16rem box hanging off an icon near the right edge widened the admin member page on a
 * phone, so the whole page scrolled sideways into blank space. This fails on
 *   1. an absolutely or fixed positioned box with a width that is hidden by `opacity-0` or `invisible`, and
 *   2. `role="tooltip"` outside InfoTip,
 * in app and components, unless the file is listed with a reason. A stale entry fails too.
 */
const ALLOWED_TOOLTIP_ROLE: Record<string, string> = {
  "components/chat/ReactionBar.tsx": "hover card of a reaction chip: display:none until shown, anchored to the chip it names",
  "components/ReasonBadges.tsx": "rendered only while shown (state), centred above a small badge; nothing laid out at rest",
};
const ALLOWED_HIDDEN_BOX: Record<string, string> = {};

const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(tsx|jsx)$/.test(entry.name) ? [full] : [];
  });
}

const POSITIONED = /(?<![\w:-])(?:absolute|fixed)(?![\w-])/;
const HIDDEN = /(?<![\w:-])(?:opacity-0|invisible)(?![\w-])/;
const WIDTH = /(?<![\w:-])(?:w-\d+|w-\[[^\]]+\]|w-max|w-full|min-w-\S+)(?![\w])/;

/** Files with a class string that is a positioned, sized box hidden by opacity or visibility. */
export function hiddenBoxes(source: string): boolean {
  return source
    .split("\n")
    .some((line) => /className=/.test(line) && POSITIONED.test(line) && HIDDEN.test(line) && WIDTH.test(line));
}

describe("tooltips", () => {
  const files = ["app", "components"]
    .flatMap((dir) => sourceFiles(path.join(root, dir)))
    .map((file) => [path.relative(root, file), fs.readFileSync(file, "utf8")] as const);

  it("detects the hand-rolled pattern", () => {
    expect(hiddenBoxes(`<div className="opacity-0 group-hover:opacity-100 absolute left-0 top-6 w-64 p-3">x</div>`)).toBe(true);
    expect(hiddenBoxes(`<div className="invisible group-hover:visible fixed w-48">x</div>`)).toBe(true);
    expect(hiddenBoxes(`<div className="hidden group-hover:block absolute left-0 w-64">x</div>`)).toBe(false);
    expect(hiddenBoxes(`<div className="md:absolute opacity-0">x</div>`)).toBe(false);
  });

  it("has no hover box hidden with opacity-0 or invisible (use InfoTip)", () => {
    const offenders = files
      .filter(([file, src]) => file !== "components/InfoTip.tsx" && hiddenBoxes(src))
      .map(([file]) => file)
      .filter((file) => !(file in ALLOWED_HIDDEN_BOX));
    expect(offenders, "use components/InfoTip.tsx (display:none, phone-safe) instead of a hand-rolled hover box").toEqual([]);
    for (const file of Object.keys(ALLOWED_HIDDEN_BOX)) {
      expect(files.find(([f]) => f === file)?.[1] && hiddenBoxes(files.find(([f]) => f === file)![1]), `stale: ${file}`).toBe(true);
    }
  });

  it('has no role="tooltip" outside InfoTip unless listed', () => {
    const withRole = files.filter(([, src]) => src.includes('role="tooltip"')).map(([file]) => file);
    const offenders = withRole.filter((file) => file !== "components/InfoTip.tsx" && !(file in ALLOWED_TOOLTIP_ROLE));
    expect(offenders, "use components/InfoTip.tsx").toEqual([]);
    for (const file of Object.keys(ALLOWED_TOOLTIP_ROLE)) expect(withRole, `stale: ${file}`).toContain(file);
  });
});
