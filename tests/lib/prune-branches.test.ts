import { describe, expect, it } from "vitest";
import { mergedPullBlockingPush } from "@/scripts/check-push-target";
import { planPrune, type PullRef } from "@/scripts/prune-branches";

const pull = (headRefName: string, headRefOid: string, state: PullRef["state"]): PullRef => ({ headRefName, headRefOid, state });
const keep = new Set(["main", "current-work"]);

describe("planPrune", () => {
  it("removes a branch that still points at the commit its pull request merged", () => {
    const plan = planPrune([{ name: "feat-a", sha: "aaa" }], [pull("feat-a", "aaa", "MERGED")], keep);
    expect(plan.remove).toEqual([{ name: "feat-a", sha: "aaa" }]);
    expect(plan.keep).toEqual([]);
  });

  it("keeps a branch with commits beyond the merged pull request, so a follow-up is not lost", () => {
    const plan = planPrune([{ name: "feat-a", sha: "bbb" }], [pull("feat-a", "aaa", "MERGED")], keep);
    expect(plan.remove).toEqual([]);
    expect(plan.keep[0]).toMatchObject({ name: "feat-a", reason: expect.stringContaining("not in the merged pull request") });
  });

  it("keeps branches with an open pull request, even if an older one merged", () => {
    const pulls = [pull("feat-a", "aaa", "MERGED"), pull("feat-a", "bbb", "OPEN")];
    expect(planPrune([{ name: "feat-a", sha: "aaa" }], pulls, keep).remove).toEqual([]);
  });

  it("keeps branches whose pull request was closed unmerged, and branches with none", () => {
    const branches = [
      { name: "abandoned", sha: "ccc" },
      { name: "no-pr", sha: "ddd" },
    ];
    const plan = planPrune(branches, [pull("abandoned", "ccc", "CLOSED")], keep);
    expect(plan.remove).toEqual([]);
    expect(plan.keep.map((entry) => entry.name)).toEqual(["abandoned", "no-pr"]);
  });

  it("never removes the default branch or a checked-out branch", () => {
    const branches = [
      { name: "main", sha: "eee" },
      { name: "current-work", sha: "fff" },
    ];
    const pulls = [pull("main", "eee", "MERGED"), pull("current-work", "fff", "MERGED")];
    expect(planPrune(branches, pulls, keep).remove).toEqual([]);
  });
});

describe("mergedPullBlockingPush", () => {
  it("blocks a branch whose pull request merged and has no open one", () => {
    expect(mergedPullBlockingPush([{ number: 234, state: "MERGED" }])).toEqual({ number: 234, state: "MERGED" });
  });

  it("allows a new branch, an open pull request, and a closed one", () => {
    expect(mergedPullBlockingPush([])).toBeUndefined();
    expect(mergedPullBlockingPush([{ number: 1, state: "OPEN" }])).toBeUndefined();
    expect(mergedPullBlockingPush([{ number: 1, state: "CLOSED" }])).toBeUndefined();
  });

  it("allows a branch that was merged before but has a new open pull request", () => {
    expect(
      mergedPullBlockingPush([
        { number: 1, state: "MERGED" },
        { number: 2, state: "OPEN" },
      ]),
    ).toBeUndefined();
  });
});
