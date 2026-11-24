import { describe, expect, it } from "vitest";
import { comparisonRef, isDocsOnly, PRODUCTION_TAG_REF } from "@/scripts/docs-only";

describe("isDocsOnly", () => {
  it("accepts markdown anywhere, the docs folder and .mdc rules", () => {
    expect(isDocsOnly(["CLAUDE.md", "docs/TODO.md", "docs/img/flow.png", ".claude/rules/ship-via-pr.md"])).toBe(true);
    expect(isDocsOnly(["src/app/api/webhooks/README.md", ".claude/rules/use-realtime.mdc"])).toBe(true);
  });

  it("rejects a change that touches anything else, even next to docs", () => {
    expect(isDocsOnly(["docs/TODO.md", "src/lib/config.ts"])).toBe(false);
    expect(isDocsOnly(["docs/TODO.md", "supabase/migrations/20261122000000_add_thing.sql"])).toBe(false);
    expect(isDocsOnly(["README.md", ".github/workflows/ci.yml"])).toBe(false);
  });

  it("treats the member help articles as code, because the app reads them at build time", () => {
    expect(isDocsOnly(["src/content/help/join-a-prickle.md"])).toBe(false);
    expect(isDocsOnly(["docs/TODO.md", "src/content/help/join-a-prickle.md"])).toBe(false);
    expect(isDocsOnly(["docs/help/notes.md"])).toBe(true);
    expect(isDocsOnly(["docs/runbooks/SETUP.md", "docs/decisions/PRD.md", "docs/README.md"])).toBe(true);
  });

  it("does not treat look-alike paths as docs", () => {
    expect(isDocsOnly(["src/app/docs/page.tsx"])).toBe(false);
    expect(isDocsOnly(["docs.ts"])).toBe(false);
    expect(isDocsOnly(["notes.md.ts"])).toBe(false);
    expect(isDocsOnly([".claude/settings.json"])).toBe(false);
  });

  it("answers false for an empty change, so nothing is skipped by accident", () => {
    expect(isDocsOnly([])).toBe(false);
  });
});

describe("comparisonRef", () => {
  it("compares a pull request with its base branch", () => {
    expect(comparisonRef("pull_request", "main")).toBe("main");
  });

  it("compares a push to main with the deployed commit, not the previous push", () => {
    expect(comparisonRef("push", "")).toBe(PRODUCTION_TAG_REF);
  });

  it("has no base for a manual redeploy or an unknown event, so everything runs", () => {
    expect(comparisonRef("workflow_dispatch", "")).toBeNull();
    expect(comparisonRef("pull_request", "")).toBeNull();
    expect(comparisonRef("schedule", "main")).toBeNull();
  });
});
