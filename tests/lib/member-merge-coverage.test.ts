import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DERIVED, MERGE_TABLE_LABELS, MOVED, NOT_MOVED } from "@/lib/member-merge-coverage";

// Every table that references `members` must be classified in lib/member-merge-coverage.ts (the merge dialog
// reads the same lists), and a new one fails until someone decides: move it in the merge, or add it to NOT_MOVED
// with a TODO.

/** The public tables whose generated type lists a foreign key to `members`. */
function tablesReferencingMembers(): string[] {
  const lines = readFileSync("lib/data/database.types.ts", "utf8").split("\n");
  const publicAt = lines.indexOf("  public: {");
  const start = lines.findIndex((l, i) => i > publicAt && l === "    Tables: {");
  const end = lines.findIndex((l, i) => i > start && l === "    Views: {");
  const found = new Set<string>();
  let table: string | null = null;
  for (const line of lines.slice(start + 1, end)) {
    const open = /^ {6}(\w+): \{$/.exec(line);
    if (open) table = open[1];
    if (table && line.includes('referencedRelation: "members"')) found.add(table);
  }
  return [...found].sort();
}

describe("member merge coverage", () => {
  it("classifies every table that references members", () => {
    const classified: string[] = [...MOVED, ...DERIVED, ...NOT_MOVED].sort();
    const referencing = tablesReferencingMembers();
    expect(referencing.filter((t) => !classified.includes(t)), "a new table references members: move it in the merge, or add it to NOT_MOVED with a TODO").toEqual([]);
    expect(classified.filter((t) => !referencing.includes(t)), "listed here but no longer references members: remove it").toEqual([]);
  });

  it("has a label for every table the dialog can show", () => {
    expect(([...MOVED, ...NOT_MOVED] as string[]).filter((t) => !MERGE_TABLE_LABELS[t])).toEqual([]);
  });

  it("lists each table once", () => {
    const all = [...MOVED, ...DERIVED, ...NOT_MOVED];
    expect(all.filter((t, i) => all.indexOf(t) !== i)).toEqual([]);
  });
});
