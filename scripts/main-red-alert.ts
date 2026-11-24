// Keeps one GitHub issue, labelled `main-red`, that says when a CI run on main failed, and closes it
// when a later run on main passes. GitHub then notifies the repo's watchers. A red `main` means the
// merged commit was not promoted (no migration push, no deploy) and used to be noticed only by
// whoever happened to look.
//
// Run by .github/workflows/main-red-alert.yml (a `workflow_run` of CI on main), on main's own
// checkout, bare Node (24 strips types), no install:
//
//   node scripts/main-red-alert.ts
//   env: GH_TOKEN, GITHUB_REPOSITORY, RUN_ID, RUN_CONCLUSION, RUN_EVENT, RUN_SHA, RUN_URL
//
// Everything from the event arrives through the environment and is validated before use; commands
// are run without a shell. The issue holds job names, a commit sha and a link, never log text.
import { execFileSync } from "node:child_process";

export const LABEL = "main-red";
export const ISSUE_TITLE = "main is red: the latest CI run on main failed";
/** A passing run only counts as "main is fixed" when the tests really ran (a docs-only run skips them). */
export const PROOF_JOB = "Test (unit)";

export type RunJob = { name: string; conclusion: string | null };
export type RunInfo = { id: string; conclusion: string; event: string; sha: string; url: string };
export type OpenIssue = { number: number; body: string };

export type Action =
  | { kind: "none"; reason: string }
  | { kind: "report"; failed: string[] }
  | { kind: "close" };

/** Job names that failed (not cancelled or skipped), safe to put in markdown. */
export function failedJobNames(jobs: RunJob[]): string[] {
  return jobs
    .filter((job) => job.conclusion === "failure" || job.conclusion === "timed_out")
    .map((job) => job.name.replace(/[`\r\n]/g, " ").trim());
}

export function decide(run: RunInfo, jobs: RunJob[]): Action {
  if (run.event !== "push" && run.event !== "workflow_dispatch") return { kind: "none", reason: `event ${run.event} is not a run on main` };
  if (run.conclusion === "failure") return { kind: "report", failed: failedJobNames(jobs) };
  if (run.conclusion === "success") {
    const proof = jobs.find((job) => job.name === PROOF_JOB);
    return proof?.conclusion === "success"
      ? { kind: "close" }
      : { kind: "none", reason: `${PROOF_JOB} did not run, so this success does not show main is fixed` };
  }
  return { kind: "none", reason: `conclusion ${run.conclusion} (a cancelled run says nothing)` };
}

export function issueBody(run: RunInfo, failed: string[]): string {
  const list = failed.length > 0 ? failed.map((name) => `- ${name}`).join("\n") : "- (no single failed job; see the run)";
  return [
    `The CI run on \`main\` for commit ${run.sha} failed, so that commit was not promoted: nothing from it deployed, and migrations were not pushed if the failure came first.`,
    "",
    "Failed jobs:",
    list,
    "",
    `Run: ${run.url}`,
    "",
    "This issue closes itself when a later run on `main` passes. Fix forward with a new pull request; see step 7 of `.claude/rules/ship-via-pr.md`.",
  ].join("\n");
}

export type Api = {
  openIssue(): OpenIssue | undefined;
  createIssue(title: string, body: string): void;
  editIssue(number: number, body: string): void;
  comment(number: number, body: string): void;
  closeIssue(number: number, comment: string): void;
};

/** Apply the decision; returns a line for the log. */
export function apply(run: RunInfo, action: Action, api: Api): string {
  if (action.kind === "none") return `Nothing to do: ${action.reason}.`;
  const issue = api.openIssue();
  if (action.kind === "close") {
    if (!issue) return "main passed and no main-red issue is open.";
    api.closeIssue(issue.number, `A later run on \`main\` passed (commit ${run.sha}): ${run.url}`);
    return `Closed issue #${issue.number}.`;
  }
  const body = issueBody(run, action.failed);
  if (!issue) {
    api.createIssue(ISSUE_TITLE, body);
    return "Opened the main-red issue.";
  }
  if (issue.body.includes(run.url)) return `Issue #${issue.number} already reports this run.`;
  api.editIssue(issue.number, body);
  api.comment(issue.number, `Still red: commit ${run.sha} failed too. ${run.url}`);
  return `Updated issue #${issue.number}.`;
}

function gh(...args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function realApi(repo: string): Api {
  return {
    openIssue: () => {
      const issues = JSON.parse(gh("issue", "list", "--repo", repo, "--label", LABEL, "--state", "open", "--json", "number,body", "--limit", "5")) as OpenIssue[];
      return issues[0];
    },
    createIssue: (title, body) => {
      try {
        gh("label", "create", LABEL, "--repo", repo, "--description", "The latest CI run on main failed", "--color", "B60205");
      } catch {
        // Already exists.
      }
      gh("issue", "create", "--repo", repo, "--title", title, "--body", body, "--label", LABEL);
    },
    editIssue: (number, body) => {
      gh("issue", "edit", String(number), "--repo", repo, "--body", body);
    },
    comment: (number, body) => {
      gh("issue", "comment", String(number), "--repo", repo, "--body", body);
    },
    closeIssue: (number, comment) => {
      gh("issue", "close", String(number), "--repo", repo, "--comment", comment);
    },
  };
}

/** Reads and validates the event values from the environment. */
export function runFromEnv(env: Record<string, string | undefined>): { repo: string; run: RunInfo } {
  const repo = env.GITHUB_REPOSITORY ?? "";
  const run: RunInfo = {
    id: env.RUN_ID ?? "",
    conclusion: env.RUN_CONCLUSION ?? "",
    event: env.RUN_EVENT ?? "",
    sha: env.RUN_SHA ?? "",
    url: env.RUN_URL ?? "",
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error("GITHUB_REPOSITORY is not owner/name");
  if (!/^\d+$/.test(run.id)) throw new Error("RUN_ID is not a number");
  if (!/^[0-9a-f]{40}$/.test(run.sha)) throw new Error("RUN_SHA is not a commit sha");
  if (!run.url.startsWith(`https://github.com/${repo}/actions/runs/`)) throw new Error("RUN_URL is not a run of this repository");
  return { repo, run };
}

function main() {
  const { repo, run } = runFromEnv(process.env);
  const jobs = (
    JSON.parse(gh("api", `repos/${repo}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`)) as {
      jobs: { name: string; conclusion: string | null }[];
    }
  ).jobs.map((job) => ({ name: job.name, conclusion: job.conclusion }));
  console.log(apply(run, decide(run, jobs), realApi(repo)));
}

if (process.argv[1]?.endsWith("main-red-alert.ts")) main();
