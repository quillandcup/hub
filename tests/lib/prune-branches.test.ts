import { describe, expect, it } from "vitest";
import { mergedPullBlockingPush } from "@/scripts/check-push-target";
import { branchesFromReflog, planPrune, type PullRef } from "@/scripts/prune-branches";

const pull = (headRefName: string, headRefOid: string, state: PullRef["state"]): PullRef => ({ headRefName, headRefOid, state });
const keep = new Set(["main", "current-work"]);

describe("planPrune", () => {
  it("removes a branch that still points at the commit its pull request merged", () => {
    const plan = planPrune([{ name: "feat-a", sha: "aaa" }], [pull("feat-a", "aaa", "MERGED")], keep);
    expect(plan.remove).toEqual([{ name: "feat-a", sha: "aaa", why: "merged pull request" }]);
    expect(plan.keep).toEqual([]);
  });

  it("removes a branch with no pull request when every commit on it is already in main", () => {
    const plan = planPrune([{ name: "scratch", sha: "s1" }], [], keep, new Set(["scratch"]));
    expect(plan.remove).toEqual([{ name: "scratch", sha: "s1", why: "already in main" }]);
  });

  it("removes a contained branch whose pull request was closed without merging", () => {
    const plan = planPrune([{ name: "abandoned", sha: "c1" }], [pull("abandoned", "c1", "CLOSED")], keep, new Set(["abandoned"]));
    expect(plan.remove.map((branch) => branch.name)).toEqual(["abandoned"]);
  });

  it("keeps a branch with no pull request and commits main doesn't have", () => {
    const plan = planPrune([{ name: "wip", sha: "w1" }], [], keep, new Set(["scratch"]));
    expect(plan.remove).toEqual([]);
    expect(plan.keep).toEqual([{ name: "wip", reason: "no merged pull request" }]);
  });

  it("never removes a contained branch that has an open pull request or is protected", () => {
    const branches = [
      { name: "open-one", sha: "o1" },
      { name: "current-work", sha: "k1" },
    ];
    const plan = planPrune(branches, [pull("open-one", "o1", "OPEN")], keep, new Set(["open-one", "current-work"]));
    expect(plan.remove).toEqual([]);
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

describe("branchesFromReflog", () => {
  it("collects every branch a worktree switched between, and both sides of a rename", () => {
    const subjects = [
      "checkout: moving from rules-watch-verification to branch-hygiene",
      "checkout: moving from ci-skip-docs-only to rules-watch-verification",
      "commit: Rules: something",
      "checkout: moving from claude-rule-recommendations to ci-skip-docs-only",
      "Branch: renamed refs/heads/unarmed-dolphin to refs/heads/claude-rule-recommendations",
    ];
    expect([...branchesFromReflog(subjects)].sort()).toEqual([
      "branch-hygiene",
      "ci-skip-docs-only",
      "claude-rule-recommendations",
      "rules-watch-verification",
      "unarmed-dolphin",
    ]);
  });

  it("includes the branch left behind by a detach, and ignores every other entry", () => {
    const subjects = ["checkout: moving from feat-a to 224fc3372f4d", "commit (amend): message", "reset: moving to HEAD", "pull: Fast-forward"];
    expect([...branchesFromReflog(subjects)].sort()).toEqual(["224fc3372f4d", "feat-a"]);
  });

  it("is empty for an empty reflog", () => {
    expect(branchesFromReflog([]).size).toBe(0);
  });
});
