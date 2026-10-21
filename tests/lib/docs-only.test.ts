import { describe, expect, it } from "vitest";
import { isDocsOnly } from "@/scripts/docs-only";

describe("isDocsOnly", () => {
  it("accepts markdown anywhere, the docs folder and .mdc rules", () => {
    expect(isDocsOnly(["CLAUDE.md", "docs/TODO.md", "docs/img/flow.png", ".claude/rules/ship-via-pr.md"])).toBe(true);
    expect(isDocsOnly(["app/api/webhooks/README.md", ".claude/rules/use-realtime.mdc"])).toBe(true);
  });

  it("rejects a change that touches anything else, even next to docs", () => {
    expect(isDocsOnly(["docs/TODO.md", "lib/config.ts"])).toBe(false);
    expect(isDocsOnly(["docs/TODO.md", "supabase/migrations/20261122000000_add_thing.sql"])).toBe(false);
    expect(isDocsOnly(["README.md", ".github/workflows/ci.yml"])).toBe(false);
  });

  it("does not treat look-alike paths as docs", () => {
    expect(isDocsOnly(["app/docs/page.tsx"])).toBe(false);
    expect(isDocsOnly(["docs.ts"])).toBe(false);
    expect(isDocsOnly(["notes.md.ts"])).toBe(false);
    expect(isDocsOnly([".claude/settings.json"])).toBe(false);
  });

  it("answers false for an empty change, so nothing is skipped by accident", () => {
    expect(isDocsOnly([])).toBe(false);
  });
});
