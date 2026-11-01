import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The repositories in `lib/data/` are where the PostgREST client's types start, so a column or shape mistake
 * should be a compile error, not a runtime bug. Type a query by letting the client infer it from
 * `database.types.ts`; where it can't (a select string built at runtime, a view whose columns are all
 * nullable, a text column held to a union by a check constraint) end the chain with
 * `.overrideTypes<Row[], { merge: false }>()` or narrow where the rows are mapped. A cast that is truly
 * unavoidable (`as unknown as`, `as any`, `: any`, `as never`) must say why in a comment on the same or the
 * previous line, and counts against the ceiling below.
 *
 * The ceiling only goes down: if you remove a cast, lower it to the new count.
 */
const CEILING = 3;

const DIR = path.join(process.cwd(), "lib/data");
const CAST = /\bas unknown as\b|\bas any\b|:\s*any\b|<any>|\bas never\b/;

function casts() {
  const found: { file: string; line: number; text: string; explained: boolean }[] = [];
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".ts") && f !== "database.types.ts")) {
    const lines = readFileSync(path.join(DIR, file), "utf8").split("\n");
    lines.forEach((text, i) => {
      const code = text.replace(/\/\/.*$/, "").replace(/\/\*.*?\*\//g, "").replace(/^\s*\*.*$/, "");
      if (!CAST.test(code)) return;
      const comment = (s: string | undefined) => !!s && (/\/\//.test(s) || /^\s*(\/\*|\*)/.test(s) || /\*\/\s*$/.test(s));
      found.push({ file, line: i + 1, text: text.trim(), explained: comment(text) || comment(lines[i - 1]) });
    });
  }
  return found;
}

describe("lib/data type casts", () => {
  const found = casts();

  it("every remaining cast says why, on the same or the previous line", () => {
    expect(found.filter((c) => !c.explained).map((c) => `${c.file}:${c.line} ${c.text}`)).toEqual([]);
  });

  it(`stays at or below ${CEILING} (the ceiling only goes down)`, () => {
    expect(found.map((c) => `${c.file}:${c.line}`).length).toBeLessThanOrEqual(CEILING);
  });
});
