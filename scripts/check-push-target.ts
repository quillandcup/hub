// Pre-push check: refuses to push to a branch whose pull request has already merged.
//
// After a squash merge the branch is dead: new commits on it belong to no pull request, never
// reach main, and (with the remote branch deleted on merge) a push silently re-creates it.
// Follow-up work starts a new branch from origin/main.
//
//   node scripts/check-push-target.ts <remote> <url>   (ref lines on stdin, as git gives a pre-push hook)
//
// It looks the branch up on GitHub with `gh`, and lets the push through if it can't (offline,
// not signed in). Set ALLOW_MERGED_BRANCH_PUSH=1 to push anyway. Runs on bare Node (no `npm ci`),
// so it uses only node: imports and syntax Node can strip types from.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export interface BranchPull {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
}

/** The merged pull request that makes the branch dead, or undefined if pushing is fine. */
export function mergedPullBlockingPush(pulls: BranchPull[]): BranchPull | undefined {
  if (pulls.some((pull) => pull.state === "OPEN")) return undefined;
  return pulls.find((pull) => pull.state === "MERGED");
}

function pullsFor(branch: string): BranchPull[] | undefined {
  const res = spawnSync("gh", ["pr", "list", "--head", branch, "--state", "all", "--json", "number,state"], { encoding: "utf8" });
  if (res.status !== 0) return undefined;
  try {
    return JSON.parse(res.stdout) as BranchPull[];
  } catch {
    return undefined;
  }
}

function main() {
  if (process.env.ALLOW_MERGED_BRANCH_PUSH === "1") return;
  const zero = /^0+$/;
  let blocked = false;
  for (const line of readFileSync(0, "utf8").split("\n").filter(Boolean)) {
    const [, localSha, remoteRef] = line.split(" ");
    const branch = remoteRef?.replace("refs/heads/", "");
    // Deleting a branch (all-zero local sha) and tags are fine; so is the default branch.
    if (!branch || !remoteRef.startsWith("refs/heads/") || zero.test(localSha) || branch === "main") continue;
    const merged = mergedPullBlockingPush(pullsFor(branch) ?? []);
    if (!merged) continue;
    blocked = true;
    console.error(`✗ ${branch}: pull request #${merged.number} already merged, so this push would go nowhere.`);
    console.error("  Start the follow-up on a new branch from the latest main:");
    console.error("    git fetch origin main && git switch -c <new-name> origin/main");
    console.error("  then cherry-pick or re-apply your commits. To push anyway: ALLOW_MERGED_BRANCH_PUSH=1 git push");
  }
  if (blocked) process.exit(1);
}

if (process.argv[1]?.endsWith("check-push-target.ts")) main();
