import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { END_MARKER, START_MARKER, expectedReadmes, indexBlock, problems, summaryOf, titleOf, updatedReadme } from "../../scripts/docs-index";

const DOC = `# Widgets

> **Status:** living. **Last reviewed:** 2026-11-23. Review: yearly. Kept up to date with the code.

Widgets are the small [parts](PARTS.md) of **every** page. They are cheap to add.

## More
Other text.
`;

describe("titleOf", () => {
  it("reads the first heading", () => expect(titleOf(DOC)).toBe("Widgets"));
  it("is empty without a heading", () => expect(titleOf("no heading here")).toBe(""));
});

describe("summaryOf", () => {
  it("is the first sentence after the Status line, as plain text without the final period", () => {
    expect(summaryOf(DOC)).toBe("Widgets are the small parts of every page");
  });

  it("skips quotes, tables, lists, code fences, comments and headings before the prose", () => {
    const text = "# T\n\n> **Status:** living.\n\n> a note\n\n| a | b |\n|---|---|\n\n- item\n  wrapped\n\n```\ncode. here\n```\n\n<!-- c -->\n\n## H\n\nFinally prose. More.\n";
    expect(summaryOf(text)).toBe("Finally prose");
  });

  it("keeps a sentence without a final period, and joins a wrapped paragraph", () => {
    expect(summaryOf("# T\n\n> **Status:** living.\n\nOne line that wraps\nonto a second\n")).toBe("One line that wraps onto a second");
  });

  it("shortens a long first sentence", () => {
    const long = `# T\n\n> **Status:** living.\n\n${"word ".repeat(80)}end.\n`;
    const summary = summaryOf(long);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.endsWith("…")).toBe(true);
  });

  it("is empty when the doc has no prose", () => {
    expect(summaryOf("# T\n\n> **Status:** living.\n\n## H\n\n- only a list\n")).toBe("");
  });
});

describe("the index block", () => {
  const entries = [
    { file: "A.md", title: "Alpha", summary: "The first" },
    { file: "B.md", title: "Beta", summary: "" },
  ];

  it("lists each doc, with its summary when it has one", () => {
    const block = indexBlock(entries);
    expect(block).toContain("- [Alpha](A.md): The first");
    expect(block).toContain("- [Beta](B.md)\n");
  });

  it("makes a new README with a title and the folder's sentence", () => {
    const readme = updatedReadme(null, "quality", entries);
    expect(readme.startsWith("# Quality\n\n")).toBe(true);
    expect(readme).toContain(START_MARKER);
  });

  it("replaces only the block of an existing README", () => {
    const existing = `# Mine\n\nHand-written intro.\n\n${START_MARKER}\n\n- old\n\n${END_MARKER}\n\nAfterword.\n`;
    const next = updatedReadme(existing, "quality", entries);
    expect(next).toContain("Hand-written intro.");
    expect(next).toContain("Afterword.");
    expect(next).not.toContain("- old");
    expect(next).toContain("- [Alpha](A.md): The first");
    expect(updatedReadme(next, "quality", entries)).toBe(next);
  });

  it("refuses a README without the markers rather than guessing where the list goes", () => {
    expect(() => updatedReadme("# Mine\n", "quality", entries)).toThrow(/markers/);
  });

  it("reports a doc with no title or no summary", () => {
    expect(problems("quality", [{ file: "X.md", title: "", summary: "" }])).toHaveLength(2);
    expect(problems("quality", entries)).toEqual([expect.stringMatching(/^docs\/quality\/B\S* has no summary: put a plain sentence right after its Status line$/)]);
  });
});

describe("expectedReadmes", () => {
  it("reads a folder, leaves its README out of its own list, and compares with what is on disk", () => {
    const docs = mkdtempSync(path.join(os.tmpdir(), "docs-index-"));
    mkdirSync(path.join(docs, "product"));
    writeFileSync(path.join(docs, "product", "WIDGETS.md"), DOC);
    const [first] = expectedReadmes(docs, ["product"]);
    expect(first.current).toBeNull();
    expect(first.expected).toContain("- [Widgets](WIDGETS.md)");
    writeFileSync(first.file, first.expected);
    const [second] = expectedReadmes(docs, ["product"]);
    expect(second.current).toBe(second.expected);
    expect(second.expected).not.toContain("README.md");
    expect(readFileSync(first.file, "utf8")).toBe(first.expected);
  });
});
