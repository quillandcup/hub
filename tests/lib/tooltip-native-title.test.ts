import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * A hint on anything goes through `components/Tooltip.tsx` (rule: `.claude/rules/tooltips.md`), never a native
 * `title="..."`: that is a small grey browser box that looks different from every other tooltip, never shows on a touch
 * screen and can't be styled. This fails on a native `title` attribute on a lowercase (DOM) JSX element in `app` or
 * `components`. There is no baseline: every file is clean, and it has to stay that way.
 *
 * Not tooltips, so not counted (the whole allowlist):
 *  - `<iframe title>`: it names the frame for screen readers.
 *  - `<abbr title>`: the expansion of a real abbreviation, which the browser exposes as such.
 *  - `<input pattern title>`: browsers use the title as the explanation in their built-in validation message.
 * A component's own `title` prop (a modal's heading, a chart card's) is not a DOM attribute and is not counted;
 * `<svg><title>` is an element, not an attribute; a page's `<title>` is metadata.
 */
const root = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".tsx") ? [full] : [];
  });
}

/** The line numbers of native `title` tooltips in the source (empty when it has none). */
export function nativeTitles(source: string): number[] {
  const sf = ts.createSourceFile("x.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const lines: number[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText() === "title") {
      const element = node.parent.parent as ts.JsxOpeningLikeElement;
      const tag = element.tagName.getText();
      const hasPattern = element.attributes.properties.some((a) => ts.isJsxAttribute(a) && a.name.getText() === "pattern");
      const allowed = tag === "iframe" || tag === "abbr" || (tag === "input" && hasPattern);
      if (/^[a-z]/.test(tag) && !allowed) lines.push(sf.getLineAndCharacterOfPosition(node.getStart()).line + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}

describe("tooltips: no native title", () => {
  it("flags a title on a DOM element, and only that", () => {
    expect(nativeTitles(`<button title="Pin">x</button>`)).toEqual([1]);
    expect(nativeTitles(`<span title={a}>x</span>\n<a href="/" title="b">y</a>`)).toEqual([1, 2]);
    expect(nativeTitles(`<option title="why">x</option><select title="s" />`)).toEqual([1, 1]);
    expect(nativeTitles(`<Modal title="New" /><ChartCard title="x" /><Tooltip content="y"><button>z</button></Tooltip>`)).toEqual([]);
    expect(nativeTitles(`<svg><title>Chart</title></svg>`)).toEqual([]);
  });

  it("allows the three non-tooltip uses", () => {
    expect(nativeTitles(`<iframe title="Video" src="/v" />`)).toEqual([]);
    expect(nativeTitles(`<abbr title="Frequently asked questions">FAQ</abbr>`)).toEqual([]);
    expect(nativeTitles(`<input pattern="[a-z]+" title="Lowercase letters" />`)).toEqual([]);
    expect(nativeTitles(`<input title="not a validation hint" />`)).toEqual([1]);
  });

  it("has no native title tooltip anywhere in app or components (use <Tooltip content=...>)", () => {
    const offenders = ["app", "components"]
      .flatMap((dir) => sourceFiles(path.join(root, dir)))
      .flatMap((file) => nativeTitles(fs.readFileSync(file, "utf8")).map((line) => `${path.relative(root, file)}:${line}`));
    expect(offenders, "wrap the element in <Tooltip content=...> from components/Tooltip.tsx instead of title= (.claude/rules/tooltips.md)").toEqual([]);
  });
});
