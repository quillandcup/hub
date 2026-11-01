#!/usr/bin/env npx tsx
// Deletes branches whose pull request has merged. GitHub deletes the remote branch itself
// (`delete_branch_on_merge` in github-repo-config.yml) but nothing deletes local ones, and
// branches that merged before that setting existed are still on the remote.
//
//   tsx scripts/prune-branches.ts                 list local branches that can go (read-only)
//   tsx scripts/prune-branches.ts --apply         delete them
//   tsx scripts/prune-branches.ts --remote        the same for branches on origin
//   tsx scripts/prune-branches.ts --remote --apply
//   tsx scripts/prune-branches.ts --mine --apply  only branches this worktree has been on
//
// --mine reads the current worktree's own HEAD reflog (git keeps one per worktree), so it covers
// every branch an agent switched to here, whoever created it, including ones renamed since. It
// is what the Paseo teardown runs when a worktree is archived (paseo.json). The reflog goes away
// with the worktree, so it can't clean up after worktrees that are already gone; run the full
// form once for that.
//
// A branch goes when either
//   - its latest pull request merged and the branch still points at exactly the commit that was
//     merged. A branch with newer commits (a follow-up pushed after the merge) is kept and
//     reported, because deleting it would lose them. Squash merges leave the branch unmerged as
//     far as git can tell, which is why this asks GitHub instead of using `git branch --merged`; or
//   - every commit on it is already in origin/main (git's own `--merged`), with or without a pull
//     request: scratch, backup and agent branches that were never opened as a PR, or that
//     merged by fast-forward. It has nothing of its own, so deleting it loses nothing.
// Branches with an open pull request, the default branch, and branches checked out in any
// worktree are never touched.
import { spawnSync } from "node:child_process";

export interface BranchRef {
  name: string;
  sha: string;
}

export interface PullRef {
  headRefName: string;
  headRefOid: string;
  state: "OPEN" | "CLOSED" | "MERGED";
}

export interface PrunePlan {
  remove: (BranchRef & { why: "merged pull request" | "already in main" })[];
  keep: { name: string; reason: string }[];
}

/** `containedInMain` holds the names of branches whose every commit is already in the default branch. */
export function planPrune(branches: BranchRef[], pulls: PullRef[], protectedNames: Set<string>, containedInMain: Set<string> = new Set()): PrunePlan {
  const plan: PrunePlan = { remove: [], keep: [] };
  for (const branch of branches) {
    const mine = pulls.filter((pull) => pull.headRefName === branch.name);
    if (protectedNames.has(branch.name)) plan.keep.push({ name: branch.name, reason: "default branch or checked out" });
    else if (mine.some((pull) => pull.state === "OPEN")) plan.keep.push({ name: branch.name, reason: "has an open pull request" });
    else if (mine.some((pull) => pull.state === "MERGED" && pull.headRefOid === branch.sha)) plan.remove.push({ ...branch, why: "merged pull request" });
    else if (containedInMain.has(branch.name)) plan.remove.push({ ...branch, why: "already in main" });
    else if (!mine.some((pull) => pull.state === "MERGED")) plan.keep.push({ name: branch.name, reason: "no merged pull request" });
    else plan.keep.push({ name: branch.name, reason: "has commits that were not in the merged pull request" });
  }
  return plan;
}

/**
 * Branch names a worktree has been on, from its HEAD reflog subjects: `checkout: moving from A to B`
 * (switch and switch -c) and `Branch: renamed refs/heads/A to refs/heads/B`. Names that are
 * commits, or no longer exist, are harmless: the caller keeps only branches that exist.
 */
export function branchesFromReflog(subjects: string[]): Set<string> {
  const names = new Set<string>();
  for (const subject of subjects) {
    const moved = subject.match(/^checkout: moving from (\S+) to (\S+)$/);
    if (moved) {
      names.add(moved[1]);
      names.add(moved[2]);
    }
    const renamed = subject.match(/^Branch: renamed refs\/heads\/(\S+) to refs\/heads\/(\S+)$/);
    if (renamed) {
      names.add(renamed[1]);
      names.add(renamed[2]);
    }
  }
  return names;
}

function run(command: string, args: string[]): string {
  const res = spawnSync(command, args, { encoding: "utf8" });
  if (res.status !== 0) {
    console.error(`✗ ${command} ${args.join(" ")}: ${res.stderr.trim()}`);
    process.exit(1);
  }
  return res.stdout;
}

function lines(output: string): string[] {
  return output.split("\n").filter(Boolean);
}

function checkedOutBranches(): Set<string> {
  const names = lines(run("git", ["worktree", "list", "--porcelain"]))
    .filter((line) => line.startsWith("branch refs/heads/"))
    .map((line) => line.slice("branch refs/heads/".length));
  return new Set(names);
}

function defaultBranch(): string {
  return run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]).trim();
}

/**
 * Branches (local, or origin's) whose every commit is already in origin/<trunk>, by git's own
 * `--merged`. Best effort: after a fresh fetch, and empty if origin/<trunk> can't be resolved.
 * For origin the tracking ref must be at the sha `ls-remote` just reported, so a branch pushed to
 * since the fetch is not treated as merged.
 */
function containedInTrunk(trunk: string, remote: boolean, branches: BranchRef[]): Set<string> {
  spawnSync("git", ["fetch", "--quiet", "--prune", "origin"], { encoding: "utf8" });
  const base = `origin/${trunk}`;
  if (spawnSync("git", ["rev-parse", "--verify", "--quiet", base], { encoding: "utf8" }).status !== 0) {
    console.warn(`prune-branches: ${base} not available, skipping the "already in main" rule`);
    return new Set();
  }
  const prefix = remote ? "refs/remotes/origin/" : "refs/heads/";
  const merged = lines(run("git", ["for-each-ref", "--merged", base, "--format=%(objectname) %(refname)", prefix]));
  const shaByName = new Map(branches.map((branch) => [branch.name, branch.sha]));
  const names = new Set<string>();
  for (const entry of merged) {
    const [sha, ref] = entry.split(" ");
    const name = ref.slice(prefix.length);
    if (shaByName.get(name) === sha) names.add(name);
  }
  return names;
}

function main() {
  const remote = process.argv.includes("--remote");
  const apply = process.argv.includes("--apply");
  const ownOnly = process.argv.includes("--mine");
  if (ownOnly && remote) {
    console.error("✗ --mine reads this worktree's reflog and only applies to local branches; drop --remote");
    process.exit(1);
  }
  const trunk = defaultBranch();
  const protectedNames = new Set([trunk]);

  let branches: BranchRef[];
  if (remote) {
    branches = lines(run("git", ["ls-remote", "--heads", "origin"])).map((line) => {
      const [sha, ref] = line.split("\t");
      return { name: ref.replace("refs/heads/", ""), sha };
    });
  } else {
    for (const name of checkedOutBranches()) protectedNames.add(name);
    branches = lines(run("git", ["for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads/"])).map((line) => {
      const [sha, ...name] = line.split(" ");
      return { name: name.join(" "), sha };
    });
    if (ownOnly) {
      const visited = branchesFromReflog(lines(run("git", ["reflog", "show", "HEAD", "--format=%gs"])));
      branches = branches.filter((branch) => visited.has(branch.name));
    }
  }

  const pulls = JSON.parse(run("gh", ["pr", "list", "--state", "all", "--limit", "1000", "--json", "headRefName,headRefOid,state"])) as PullRef[];
  const plan = planPrune(branches, pulls, protectedNames, containedInTrunk(trunk, remote, branches));
  const where = remote ? "origin" : ownOnly ? "local (this worktree's)" : "local";

  console.log(`${where}: ${branches.length} branches, ${plan.remove.length} merged and removable, ${plan.keep.length} kept`);
  for (const branch of plan.remove) {
    const note = branch.why === "already in main" ? " (already in main, no merged pull request)" : "";
    console.log(`  ${apply ? "deleting" : "would delete"} ${branch.name}${note}`);
  }
  const unusual = plan.keep.filter((entry) => entry.reason.startsWith("has commits"));
  for (const entry of unusual) console.log(`  kept ${entry.name}: ${entry.reason}`);

  if (!apply) {
    if (plan.remove.length > 0) console.log("Dry run. Add --apply to delete.");
    return;
  }
  for (const branch of plan.remove) {
    if (remote) run("git", ["push", "origin", "--delete", branch.name]);
    else run("git", ["branch", "-D", branch.name]);
  }
}

if (process.argv[1]?.endsWith("prune-branches.ts")) main();
