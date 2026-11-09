import { describe, expect, it } from "vitest";
import { buildDraftInput, buildDraftPrompt, classifyPr, trimBody, type MergedPr } from "@/lib/changelog/draft";
import type { ChangelogEntry } from "@/lib/changelog/entries";

const pr = (number: number, files: string[], over: Partial<MergedPr> = {}): MergedPr => ({
  number,
  title: `Change ${number}`,
  mergedAt: `2026-11-0${number}T12:00:00Z`,
  body: "Body",
  files,
  ...over,
});

describe("classifyPr", () => {
  it("skips docs, tests and changelog-only changes", () => {
    expect(classifyPr({ files: ["docs/TODO.md", "tests/lib/a.test.ts"] })).toBe("skip");
    expect(classifyPr({ files: ["lib/changelog/entries.ts", "public/changelog/x/a.webp"] })).toBe("skip");
  });

  it("calls a change under a member-facing path member-visible", () => {
    expect(classifyPr({ files: ["components/chat/Sidebar.tsx", "tests/a.test.tsx"] })).toBe("member-visible");
    expect(classifyPr({ files: ["app/(member)/settings/page.tsx"] })).toBe("member-visible");
  });

  it("calls other code engineering, and a change with no files engineering", () => {
    expect(classifyPr({ files: ["lib/data/members.ts"] })).toBe("engineering");
    expect(classifyPr({ files: [] })).toBe("engineering");
  });
});

describe("trimBody", () => {
  it("leaves short bodies alone and cuts long ones", () => {
    expect(trimBody("short\r\n")).toBe("short");
    expect(trimBody("x".repeat(20), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("buildDraftInput and buildDraftPrompt", () => {
  const entries = [
    { slug: "old", date: "2026-10-01", audience: "product", title: "Old" },
    { slug: "new", date: "2026-11-02", audience: "product", title: "New thing" },
  ] as ChangelogEntry[];

  it("keeps only PRs that could matter, oldest first, and entries inside the window", () => {
    const input = buildDraftInput("2026-11-01", [pr(3, ["components/A.tsx"]), pr(1, ["docs/a.md"]), pr(2, ["lib/x.ts"])], entries);
    expect(input.prs.map((p) => [p.number, p.kind])).toEqual([[2, "engineering"], [3, "member-visible"]]);
    expect(input.existing.map((e) => e.slug)).toEqual(["new"]);
  });

  it("names the rules files, existing entries and each PR in the prompt", () => {
    const input = buildDraftInput("2026-11-01", [pr(3, Array.from({ length: 14 }, (_, i) => `components/F${i}.tsx`))], entries);
    const prompt = buildDraftPrompt(input);
    expect(prompt).toContain(".claude/rules/changelog-writing.md");
    expect(prompt).toContain("- 2026-11-02 [product] new: New thing");
    expect(prompt).toContain("### #3 Change 3");
    expect(prompt).toContain("(14 files)");
  });

  it("says (none) when no entry exists in the window", () => {
    expect(buildDraftPrompt(buildDraftInput("2027-01-01", [], entries))).toContain("(none)");
  });
});
