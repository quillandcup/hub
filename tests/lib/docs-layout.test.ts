import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// docs/ is sorted by whether a doc is living (kept up to date with the code) or a snapshot (a
// decision or analysis as of a date). See docs/README.md.
const ROOT = path.resolve(__dirname, "../..");
const DOCS = path.join(ROOT, "docs");
const LIVING_FOLDERS = ["runbooks", "checklists", "architecture", "infrastructure", "trust", "product"];
const SNAPSHOT_FOLDERS = ["decisions"];
const ALL_FOLDERS = [...LIVING_FOLDERS, ...SNAPSHOT_FOLDERS];

function docsIn(folder: string): string[] {
  return readdirSync(path.join(DOCS, folder)).filter((f) => f.endsWith(".md"));
}

// The first lines under the title are the status header.
function header(folder: string, file: string): string {
  return readFileSync(path.join(DOCS, folder, file), "utf8").split("\n").slice(0, 6).join("\n");
}

describe("docs layout", () => {
  it("has only TODO.md and README.md as markdown directly under docs/", () => {
    const top = readdirSync(DOCS).filter((f) => f.endsWith(".md"));
    expect(top.sort()).toEqual(["README.md", "TODO.md"]);
  });

  for (const folder of ALL_FOLDERS) {
    it(`${folder}/ has docs and each opens with a status header`, () => {
      const files = docsIn(folder);
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const lines = readFileSync(path.join(DOCS, folder, file), "utf8").split("\n");
        expect(lines[0], `${folder}/${file} starts with a title`).toMatch(/^# /);
        expect(header(folder, file), `${folder}/${file} has a status header`).toMatch(/^> \*\*Status:\*\* (living|snapshot)/m);
      }
    });
  }

  it("marks decisions as snapshots with a date, and everything else as living", () => {
    for (const folder of SNAPSHOT_FOLDERS) {
      for (const file of docsIn(folder)) {
        expect(header(folder, file), `${folder}/${file}`).toMatch(/^> \*\*Status:\*\* snapshot, as of \d{4}-\d{2}-\d{2}\./m);
      }
    }
    for (const folder of LIVING_FOLDERS) {
      for (const file of docsIn(folder)) {
        expect(header(folder, file), `${folder}/${file}`).toMatch(/^> \*\*Status:\*\* living\./m);
      }
    }
  });

  it("names a review cadence on runbooks and checklists", () => {
    for (const folder of ["runbooks", "checklists"]) {
      for (const file of docsIn(folder)) {
        expect(header(folder, file), `${folder}/${file}`).toMatch(/Review: (quarterly|yearly)\./);
      }
    }
  });

  it("has no loose files in the folders besides markdown", () => {
    for (const folder of ALL_FOLDERS) {
      expect(readdirSync(path.join(DOCS, folder)).filter((f) => !f.endsWith(".md"))).toEqual([]);
    }
  });
});

describe("references to docs", () => {
  // Pre-existing mentions of docs that do not exist (a deleted doc, a planned one).
  // KNOWN GAP: point them at a real doc or drop them.
  const KNOWN_DANGLING = new Set(["FEATURE_MANIFEST", "CONVERSATIONS"]);

  it("every mention of a docs/NAME.md file resolves to a file that exists", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 })
      .toString()
      .split("\0")
      .filter((f) => f && !f.endsWith("tests/lib/docs-layout.test.ts") && !/\.(png|jpe?g|webp|gif|ico|woff2?|mp4|mp3|wav|pdf|zip|csv)$/i.test(f));
    const mention = /(?<![A-Za-z0-9_])docs\/((?:[a-z]+\/)?[A-Z][A-Z0-9_]*)\.md/g;
    const dangling: string[] = [];
    for (const file of tracked) {
      const abs = path.join(ROOT, file);
      if (!existsSync(abs)) continue;
      const text = readFileSync(abs, "utf8");
      for (const match of text.matchAll(mention)) {
        if (KNOWN_DANGLING.has(match[1])) continue;
        if (!existsSync(path.join(DOCS, `${match[1]}.md`))) dangling.push(`${file}: ${match[0]}`);
      }
    }
    expect(dangling).toEqual([]);
  });
});
