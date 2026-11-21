import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { COMPLIANCE_GROUPS } from "@/content/compliance";
import { PRIVACY_GROUPS } from "@/lib/privacy-promises";
import { SECURITY_ITEMS } from "@/content/security";

const ROOT = resolve(__dirname, "../..");

/**
 * Every trust page row points at where its promise is kept. A path in the list that no longer exists is a row
 * nobody can check, so it fails here (a rename or a deleted file shows up in the PR that does it).
 * An entry may carry a note after the path ("lib/x.ts (what part)"); the path is its first word. Entries that
 * are prose and not a path ("no Stripe.js or checkout code anywhere") are skipped.
 */
const LISTS: Record<string, readonly string[]> = {
  security: SECURITY_ITEMS.flatMap((item) => item.staff.evidence),
  compliance: COMPLIANCE_GROUPS.flatMap((g) => g.items.flatMap((item) => item.evidence)),
  privacy: PRIVACY_GROUPS.flatMap((g) => g.rows.flatMap((row) => row.evidence)),
};

function pathOf(entry: string): string | null {
  const first = entry.split(" ")[0];
  return /^[\w.@()/[\]-]+\.\w+$/.test(first) || /^[\w.@()/[\]-]+\/$/.test(first) ? first : null;
}

describe("trust page evidence", () => {
  for (const [name, entries] of Object.entries(LISTS)) {
    it(`${name}: every path it names exists`, () => {
      const paths = entries.map(pathOf).filter((p): p is string => p !== null);
      // Guard against the check going quiet: most entries are paths.
      expect(paths.length).toBeGreaterThanOrEqual(Math.floor(entries.length / 2));
      for (const path of paths) expect(existsSync(resolve(ROOT, path)), `${name}: ${path} should exist`).toBe(true);
    });
  }

  it("staff text carries no literal backticks (the pages render plain text, so they would show)", () => {
    const text: string[] = [
      ...SECURITY_ITEMS.flatMap((i) => [i.staff.how, ...i.staff.open]),
      ...COMPLIANCE_GROUPS.flatMap((g) => g.items.flatMap((i) => [i.detail, ...i.open])),
      ...PRIVACY_GROUPS.flatMap((g) => g.rows.flatMap((r) => [r.how, ...r.open])),
    ];
    expect(text.length).toBeGreaterThan(50);
    for (const t of text) expect(t, `"${t.slice(0, 60)}..." has a backtick`).not.toContain("`");
  });
});
