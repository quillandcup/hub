import { describe, expect, it } from "vitest";
import {
  buildDraftInput,
  buildGroupPrompt,
  buildStoryPrompt,
  classifyPr,
  easternDay,
  firstDeployAfter,
  flagsMentioned,
  parseGrouping,
  trimBody,
  type MergedPr,
} from "@/lib/changelog/draft";
import type { ChangelogEntry } from "@/lib/changelog/entries";

const pr = (number: number, files: string[], over: Partial<MergedPr> = {}): MergedPr => ({
  number,
  title: `Change ${number}`,
  mergedAt: `2026-11-0${number}T12:00:00Z`,
  body: "Body",
  files,
  ...over,
});

const options = { flagKeys: ["chat_videos", "hosting"], liveFlags: [] as string[], deployTimes: ["2026-11-03T13:00:00Z", "2026-11-02T13:00:00Z"] };

describe("classifyPr", () => {
  it("skips docs, tests, demo and changelog-only changes", () => {
    expect(classifyPr({ files: ["docs/TODO.md", "tests/lib/a.test.ts"] })).toBe("skip");
    expect(classifyPr({ files: ["lib/changelog/entries.ts", "public/changelog/x/a.webp", "demo/scenes/a.spec.ts"] })).toBe("skip");
  });

  it("calls a change under a member-facing path member-visible, but not an admin screen", () => {
    expect(classifyPr({ files: ["components/chat/Sidebar.tsx", "tests/a.test.tsx"] })).toBe("member-visible");
    expect(classifyPr({ files: ["app/(member)/settings/page.tsx"] })).toBe("member-visible");
    expect(classifyPr({ files: ["components/admin/Table.tsx"] })).toBe("engineering");
    expect(classifyPr({ files: ["app/(admin)/admin/users/page.tsx"] })).toBe("engineering");
  });

  it("calls other code engineering, and a change with no files engineering", () => {
    expect(classifyPr({ files: ["lib/data/members.ts"] })).toBe("engineering");
    expect(classifyPr({ files: [] })).toBe("engineering");
  });
});

describe("flags and deployments", () => {
  it("finds the flag keys a PR names", () => {
    expect(flagsMentioned({ title: "Chat videos", body: "behind `chat_videos`" }, ["chat_videos", "hosting"])).toEqual(["chat_videos"]);
    expect(flagsMentioned({ title: "x", body: "y" }, ["hosting"])).toEqual([]);
    expect(flagsMentioned({ title: "Hosting: refresh in place", body: "the hosting page" }, ["hosting"])).toEqual([]);
  });

  it("takes the first deployment after the merge, or null", () => {
    expect(firstDeployAfter("2026-11-02T12:00:00Z", ["2026-11-03T13:00:00Z", "2026-11-02T13:00:00Z"])).toBe("2026-11-02T13:00:00Z");
    expect(firstDeployAfter("2026-11-05T12:00:00Z", ["2026-11-03T13:00:00Z"])).toBeNull();
  });

  it("names the Eastern day, not the UTC one", () => {
    expect(easternDay("2026-11-03T02:30:00Z")).toBe("2026-11-02");
    expect(easternDay("2026-11-03T13:00:00Z")).toBe("2026-11-03");
  });
});

describe("trimBody", () => {
  it("leaves short bodies alone and cuts long ones", () => {
    expect(trimBody("short\r\n")).toBe("short");
    expect(trimBody("x".repeat(20), 10)).toBe(`${"x".repeat(10)}…`);
  });
});

describe("buildDraftInput", () => {
  const entries = [
    { slug: "old", date: "2026-10-01", audience: "product", title: "Old" },
    { slug: "new", date: "2026-11-02", audience: "product", title: "New thing" },
  ] as ChangelogEntry[];

  it("keeps PRs that could matter oldest first with their live day, and entries inside the window", () => {
    const input = buildDraftInput("2026-11-01", [pr(3, ["components/A.tsx"]), pr(1, ["docs/a.md"]), pr(2, ["lib/x.ts"])], entries, options);
    expect(input.prs.map((p) => [p.number, p.kind, p.liveOn])).toEqual([
      [2, "engineering", "2026-11-02"],
      [3, "member-visible", "2026-11-03"],
    ]);
    expect(input.existing.map((e) => e.slug)).toEqual(["new"]);
  });

  it("holds back a PR that names a flag not on for everyone, and lets it through once it is", () => {
    const flagged = pr(2, ["components/A.tsx"], { body: "behind `chat_videos`" });
    expect(buildDraftInput("2026-11-01", [flagged], entries, options).held).toEqual([{ number: 2, title: "Change 2", flags: ["chat_videos"] }]);
    const live = buildDraftInput("2026-11-01", [flagged], entries, { ...options, liveFlags: ["chat_videos"] });
    expect(live.held).toEqual([]);
    expect(live.prs.map((p) => p.number)).toEqual([2]);
  });

  it("has no live day for a PR that is not deployed yet", () => {
    const input = buildDraftInput("2026-11-01", [pr(2, ["lib/x.ts"])], entries, { ...options, deployTimes: [] });
    expect(input.prs[0].liveOn).toBeNull();
  });
});

describe("prompts", () => {
  const entries = [{ slug: "new", date: "2026-11-02", audience: "product", title: "New thing" }] as ChangelogEntry[];
  const input = buildDraftInput("2026-11-01", [pr(3, ["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts"], { body: "x".repeat(2000) }), pr(2, ["components/B.tsx"])], entries, options);

  it("the grouping prompt has titles and a few files but no bodies", () => {
    const prompt = buildGroupPrompt(input);
    expect(prompt).toContain("#3 [engineering] Change 3 (a/1.ts, a/2.ts, a/3.ts, …)");
    expect(prompt).toContain("- new: New thing");
    expect(prompt).not.toContain("xxxxx");
  });

  it("the story prompt has the rules and only the trimmed bodies of the named PRs", () => {
    const prompt = buildStoryPrompt([{ slug: "s", title: "S", prs: [3] }], input, "RULES HERE");
    expect(prompt).toContain("RULES HERE");
    expect(prompt).toContain("#3 Change 3 (live 2026-11-03)");
    expect(prompt).not.toContain("#2 Change 2");
    expect(prompt.length).toBeLessThan(3000);
  });

  it("parses the grouping around other text and drops unknown PR numbers", () => {
    const text = 'Here you go:\n{"stories":[{"slug":"a","title":"A","prs":[2,99]},{"slug":"","title":"","prs":[2]},{"slug":"b","title":"B","prs":[99]}],"engineering":[3,98],"skip":"no"}';
    expect(parseGrouping(text, new Set([2, 3]))).toEqual({ stories: [{ slug: "a", title: "A", prs: [2] }], engineering: [3], skip: [] });
    expect(() => parseGrouping("no json", new Set())).toThrow("no JSON");
  });
});
