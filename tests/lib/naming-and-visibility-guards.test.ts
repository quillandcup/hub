import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Two guards that read the repository's own files.
 *
 * 1. The feature is "writer profiles" everywhere (docs/product/WRITER_TITLES.md), in what members read, in the docs and in the
 *    names in the code. "Writer page" is not a name for it. Migrations are history and stay as they were written.
 * 2. Nothing reads a visibility level by asking for `community`. A level is a rank (private < community < public) and "shown to
 *    members" means "not private" (`isShownToMembers`, `src/lib/writing-visibility.ts`; `<> 'private'` in SQL), so a globe item is
 *    shown to members too. `community` appears as a default or in a backfill or a sync trigger, never as a test of what a reader may see.
 */
const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n")
  .filter((file) => file && fs.existsSync(file));

const TEXT = /\.(tsx?|mts|md|mdx|sql|json|toml|ya?ml)$/;
const read = (file: string) => fs.readFileSync(file, "utf8");

const WRITER_PAGE_WORDS = [/\bwriters?['’]?\s+(public\s+)?pages?\b/i, /writer[-_]pages?\b/i, /\bWriterPages?\b/, /\bwriterPages?\b/, /\bWRITER_PAGES?\b/];
/** Lines that may keep the old words, by file, because they are about the rename itself: the old flag key still has rows to remove. */
const WRITER_PAGE_ALLOWED: Record<string, RegExp> = { "docs/TODO.md": /writer_pages` (flag|to `writer_profiles`)|old writer_pages flag rows|`writer_pages` rows/ };

describe("the feature is called writer profiles", () => {
  it("never says writer page (or writers' pages) in copy, code names or docs", () => {
    const offenders: string[] = [];
    for (const file of tracked) {
      if (!TEXT.test(file) || file.startsWith("supabase/migrations/") || file === "tests/lib/naming-and-visibility-guards.test.ts") continue;
      const lines = read(file).split("\n");
      lines.forEach((line, i) => {
        if (WRITER_PAGE_WORDS.some((word) => word.test(line)) && !WRITER_PAGE_ALLOWED[file]?.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("keeps no file or folder named for writer pages", () => {
    expect(tracked.filter((file) => /writer[-_]?pages?/i.test(file))).toEqual([]);
  });
});

/** Migrations that write or sync the `community` level (defaults, backfills, triggers): they set it, and nothing reads it for access. */
const COMMUNITY_WRITERS = new Set([
  "supabase/migrations/20270831000000_writing_three_level_visibility.sql",
  "supabase/migrations/20270844000000_profile_field_visibility.sql",
]);

// TypeScript: an equality test against the string. SQL: `<>` or a `visibility = 'community'` comparison.
const TS_EQUALITY = /(===|!==|==|!=)\s*["']community["']|["']community["']\s*(===|!==|==|!=)/;
const SQL_COMPARISON = /<>\s*'community'|\bvisibility\s*=\s*'community'|'community'\s*=\s*\w*visibility/i;

describe("visibility is read as 'not private', never as 'community'", () => {
  it("has no equality test against community in the app, the library, the components or a migration", () => {
    const offenders: string[] = [];
    for (const file of tracked) {
      const isCode = /^src\/(app|lib|components)\/.*\.tsx?$/.test(file);
      const isMigration = file.startsWith("supabase/migrations/") && file.endsWith(".sql") && !COMMUNITY_WRITERS.has(file);
      if (!isCode && !isMigration) continue;
      const pattern = isCode ? TS_EQUALITY : SQL_COMPARISON;
      read(file)
        .split("\n")
        .forEach((line, i) => {
          if (!/^\s*(--|\/\/|\*|\/\*)/.test(line) && pattern.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  it("catches what it is meant to catch", () => {
    for (const line of [`if (visibility === "community") {`, `row.visibility !== 'community'`, `"community" == level`]) expect(TS_EQUALITY.test(line), line).toBe(true);
    for (const line of [`WHERE p.visibility = 'community'`, `AND a.visibility <> 'community'`]) expect(SQL_COMPARISON.test(line), line).toBe(true);
    for (const line of [`visibility: "community",`, `const wanted = visibility === true ? "community" : visibility;`, `WHERE p.visibility <> 'private'`]) {
      expect(TS_EQUALITY.test(line) || SQL_COMPARISON.test(line), line).toBe(false);
    }
  });

  it("describes a globe item as shown to members too", async () => {
    const { isShownToMembers } = await import("@/lib/writing-visibility");
    expect(["private", "community", "public"].map((level) => isShownToMembers(level as "private"))).toEqual([false, true, true]);
  });
});
