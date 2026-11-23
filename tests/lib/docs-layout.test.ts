import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseReview } from "../../scripts/docs-overdue";

// docs/ is sorted by whether a doc is living (kept up to date with the code) or a snapshot (a
// decision or analysis as of a date). See docs/README.md.
const ROOT = path.resolve(__dirname, "../..");
const DOCS = path.join(ROOT, "docs");
const LIVING_FOLDERS = ["runbooks", "checklists", "architecture", "infrastructure", "trust", "product", "quality"];
const SNAPSHOT_FOLDERS = ["decisions"];
const ALL_FOLDERS = [...LIVING_FOLDERS, ...SNAPSHOT_FOLDERS];

function docsIn(folder: string): string[] {
  return readdirSync(path.join(DOCS, folder)).filter((f) => f.endsWith(".md"));
}

// docs/decisions/ holds earlier snapshots (a status header with a date), new decisions as ADRs
// (`NNNN-short-title.md`, a `Status:` line), the template, and the folder's README.
const ADR = /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const isTemplate = (file: string) => file === "0000-template.md";
const isAdr = (file: string) => ADR.test(file) && !isTemplate(file);
const isSnapshot = (file: string) => file !== "README.md" && !isTemplate(file) && !isAdr(file);
const docsToHeader = (folder: string) => (folder === "decisions" ? docsIn(folder).filter(isSnapshot) : docsIn(folder));

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
      const files = docsToHeader(folder);
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
      for (const file of docsToHeader(folder)) {
        expect(header(folder, file), `${folder}/${file}`).toMatch(/^> \*\*Status:\*\* snapshot, as of \d{4}-\d{2}-\d{2}\./m);
      }
    }
    for (const folder of LIVING_FOLDERS) {
      for (const file of docsIn(folder)) {
        expect(header(folder, file), `${folder}/${file}`).toMatch(/^> \*\*Status:\*\* living\./m);
      }
    }
  });

  // Only the shape is checked, never today's date: a doc going overdue must not turn CI red.
  // scripts/docs-overdue.ts and the weekly docs-overdue workflow report what is due.
  it("gives every living doc a valid Last reviewed date (or never) and a cadence", () => {
    for (const folder of LIVING_FOLDERS) {
      for (const file of docsIn(folder)) {
        const head = header(folder, file);
        const where = `${folder}/${file}`;
        const reviewed = /\*\*Last reviewed:\*\* (\d{4}-\d{2}-\d{2}|never)(?=[ .])/.exec(head)?.[1];
        expect(reviewed, `${where} has **Last reviewed:** YYYY-MM-DD or never`).toBeDefined();
        if (reviewed !== "never") {
          const date = new Date(`${reviewed}T00:00:00Z`);
          expect(date.toISOString().slice(0, 10), `${where} date is a real day`).toBe(reviewed);
        }
        const cadence = /Review: (quarterly|yearly)\./.exec(head)?.[1];
        expect(cadence, `${where} has Review: quarterly. or Review: yearly.`).toBeDefined();
        expect(cadence, `${where} cadence`).toBe(folder === "checklists" ? "quarterly" : "yearly");
        expect(parseReview(readFileSync(path.join(DOCS, folder, file), "utf8")), `${where} parses`).not.toBeNull();
      }
    }
  });

  it("names the two docs known to be out of date as never reviewed", () => {
    for (const file of ["SEQUENCE_DIAGRAMS.md", "ERD.md"]) {
      expect(header("architecture", file)).toMatch(/\*\*Last reviewed:\*\* never \(known out of date, see docs\/TODO\.md "Refresh the aging architecture docs"\)/);
    }
  });

  it("keeps ADRs numbered, with a Status line, and the template out of the numbering", () => {
    const files = docsIn("decisions");
    expect(files).toContain("README.md");
    expect(files).toContain("0000-template.md");
    const numbered = files.filter(isAdr);
    const numbers = numbered.map((f) => Number(f.slice(0, 4)));
    expect(new Set(numbers).size, "ADR numbers are unique").toBe(numbers.length);
    expect(numbers.every((n) => n >= 1)).toBe(true);
    for (const file of numbered) {
      const text = readFileSync(path.join(DOCS, "decisions", file), "utf8");
      expect(text.split("\n")[0], `${file} starts with a title`).toMatch(/^# /);
      expect(text, `${file} has a Status line`).toMatch(/^Status: (proposed|accepted|rejected|superseded by \d{4})\s*$/m);
      expect(text, `${file} has a Date line`).toMatch(/^Date: \d{4}-\d{2}-\d{2}\s*$/m);
    }
  });

  it("lists every earlier snapshot in the decisions README", () => {
    const readme = readFileSync(path.join(DOCS, "decisions", "README.md"), "utf8");
    for (const file of docsIn("decisions").filter(isSnapshot)) {
      expect(readme, file).toContain(`\`${file}\``);
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

  // config/.gitleaksignore is skipped: its fingerprints name the path a finding had at a past commit, which may be a doc deleted since.
  it("every mention of a docs/NAME.md file resolves to a file that exists", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 1 << 28 })
      .toString()
      .split("\0")
      .filter((f) => f && !f.endsWith("tests/lib/docs-layout.test.ts") && f !== "config/.gitleaksignore" && !/\.(png|jpe?g|webp|gif|ico|woff2?|mp4|mp3|wav|pdf|zip|csv)$/i.test(f));
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
